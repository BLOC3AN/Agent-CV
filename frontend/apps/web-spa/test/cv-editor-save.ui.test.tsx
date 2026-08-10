import { describe, expect, it, vi, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { BuilderRoute } from '../src/routes/BuilderRoute'
import * as api from '../src/lib/api'
import type { CV, CVLayout } from '../src/types'

const cv = {
  id: 'cv-1',
  title: 'CV',
  lastModified: '',
  sections: { intro: { fullName: 'A', title: '', email: '', phone: '', location: '', summary: '' }, experience: [], projects: [], education: [], skills: [], activities: [], certifications: [], languages: [] },
  design: { template: 'modern', accentColor: '#000', font: 'Roboto', fontSize: 14, spacing: 'normal' },
  activeSections: { intro: true, experience: true, projects: true, education: true, skills: true, activities: true, certifications: true, languages: true },
} as CV
const layout: CVLayout = { version: 1, nodes: [{ id: 'header', type: 'header', visible: true }] }
const envelope = (profileSnapshot = cv) => ({ id: 'cv-1', profileId: 'profile-1', layout, profileSnapshot } as never)

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

afterEach(() => vi.restoreAllMocks())

function renderBuilder() {
  vi.spyOn(api, 'getCV').mockResolvedValue(envelope())
  const router = createMemoryRouter([
    { path: '/builder/:cvId', element: <BuilderRoute /> },
    { path: '/elsewhere', element: <div>Elsewhere</div> },
  ], { initialEntries: ['/builder/cv-1'] })
  render(<RouterProvider router={router} />)
  return router
}

async function editName() {
  await screen.findByTestId('cv-editor')
  fireEvent.click(screen.getAllByTitle('Chỉnh sửa phần này')[0]!)
  fireEvent.change(screen.getByDisplayValue('A'), { target: { value: 'B' } })
}

describe('CV editor explicit save workflow', () => {
  it('saves the draft with Ctrl+S without opening the browser save dialog', async () => {
    const commit = vi.spyOn(api, 'commitCV').mockResolvedValue({ cv: envelope({ ...cv, sections: { ...cv.sections, intro: { ...cv.sections.intro, fullName: 'B' } } }) } as never)
    renderBuilder()
    await editName()

    const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true })
    act(() => window.dispatchEvent(event))

    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1))
    expect(event.defaultPrevented).toBe(true)
  })

  it('warns on route leave and unload only when the draft is dirty', async () => {
    const router = renderBuilder()
    await screen.findByTestId('cv-editor')
    const cleanUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(cleanUnload)
    expect(cleanUnload.defaultPrevented).toBe(false)

    await editName()
    const dirtyUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirtyUnload)
    expect(dirtyUnload.defaultPrevented).toBe(true)

    await act(async () => { await router.navigate('/elsewhere') })
    expect(screen.getByRole('dialog', { name: /thay đổi chưa lưu/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /hủy/i }))
    expect(screen.getByTestId('cv-editor')).toBeInTheDocument()
  })

  it('discards a dirty draft before continuing the blocked navigation', async () => {
    const router = renderBuilder()
    await editName()

    await act(async () => { await router.navigate('/elsewhere') })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /bỏ thay đổi/i }))

    await waitFor(() => expect(screen.getByText('Elsewhere')).toBeInTheDocument())
  })

  it('keeps leave blocked while Save is pending instead of discarding a committable draft', async () => {
    const pending = deferred<{ cv: ReturnType<typeof envelope> }>()
    const commit = vi.spyOn(api, 'commitCV').mockReturnValue(pending.promise as never)
    const router = renderBuilder()
    await editName()

    const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true })
    act(() => window.dispatchEvent(event))
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1))
    await act(async () => { await router.navigate('/elsewhere') })

    const dialog = screen.getByRole('dialog')
    const discard = within(dialog).getByRole('button', { name: /bỏ thay đổi/i })
    expect(discard).toBeDisabled()
    fireEvent.click(discard)
    expect(screen.getByTestId('cv-editor')).toBeInTheDocument()

    pending.resolve({ cv: envelope({ ...cv, sections: { ...cv.sections, intro: { ...cv.sections.intro, fullName: 'B' } } }) })
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('button', { name: /bỏ thay đổi/i })).not.toBeDisabled())
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /bỏ thay đổi/i }))
    await waitFor(() => expect(screen.getByText('Elsewhere')).toBeInTheDocument())
  })

  it('applies an accepted AI result to the local draft without saveCV or reload', async () => {
    const updated = { ...cv, sections: { ...cv.sections, intro: { ...cv.sections.intro, fullName: 'AI draft' } } }
    const sendChat = vi.spyOn(api, 'sendChat').mockResolvedValue({
      kind: 'patch', proposalId: 'proposal-1', summary: 'Đề xuất AI',
      ops: [{ op: 'replace', path: '/sections/intro/fullName', value: 'AI draft', rationale: 'Rõ hơn', grounding: { type: 'profile', ref: 'cv-1' } }],
      rejected: [],
    } as never)
    const settle = vi.spyOn(api, 'settleChatProposal').mockResolvedValue({ applied: 1, profile: updated } as never)
    const legacySave = vi.spyOn(api, 'saveCV').mockResolvedValue(undefined)
    renderBuilder()

    fireEvent.click(await screen.findByRole('button', { name: 'Tạo tóm tắt' }))
    expect(sendChat).toHaveBeenCalled()
    await screen.findAllByText('Đề xuất AI')
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng vào CV' }))

    await waitFor(() => expect(screen.getByText('AI draft')).toBeInTheDocument())
    expect(settle).toHaveBeenCalledWith('proposal-1', 'profile-1', [0])
    expect(legacySave).not.toHaveBeenCalled()
  })
})
