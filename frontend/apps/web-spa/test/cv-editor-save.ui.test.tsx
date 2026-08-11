import { describe, expect, it, vi, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { BuilderRoute } from '../src/routes/BuilderRoute'
import { Header } from '../src/components/Header'
import * as api from '../src/lib/api'
import type { CV, CVLayout } from '../src/types'
import { DEFAULT_CV_LAYOUT } from '@hr/schema'

const cv = {
  schemaVersion: 2, id: 'cv-1', language: 'vi',
  title: 'CV',
  lastModified: '',
  sections: { intro: { fullName: 'A', title: '', email: '', phone: '', location: '', summary: '' }, experience: [], projects: [], education: [], skills: [], activities: [], certifications: [], languages: [] },
  design: { template: 'modern', accentColor: '#000', font: 'Roboto', fontSize: 14, spacing: 'normal' },
  activeSections: { intro: true, experience: true, projects: true, education: true, skills: true, activities: true, certifications: true, languages: true },
  _meta: { verified: {}, source: 'manual', canonical: {} },
} as CV
const layout = structuredClone(DEFAULT_CV_LAYOUT) as CVLayout
const envelope = (profileSnapshot = cv, revisionNumber = 0) => ({ id: 'cv-1', profileId: 'profile-1', layout, profileSnapshot, revisionNumber } as never)

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

afterEach(() => vi.restoreAllMocks())

/** happy-dom không cài sẵn `window.print`, nên phải dựng chỗ bám cho spy. */
function spyOnPrint() {
  if (typeof window.print !== 'function') Object.defineProperty(window, 'print', { value: () => undefined, writable: true, configurable: true })
  return vi.spyOn(window, 'print').mockImplementation(() => undefined)
}

function renderBuilder() {
  vi.spyOn(api, 'getCV').mockResolvedValue(envelope())
  const router = createMemoryRouter([
    { path: '/builder/:cvId', element: <><Header /><BuilderRoute /></> },
    { path: '/elsewhere', element: <div>Elsewhere</div> },
  ], { initialEntries: ['/builder/cv-1'] })
  render(<RouterProvider router={router} />)
  return router
}

async function editName() {
  await screen.findByTestId('cv-editor')
  fireEvent.doubleClick(screen.getByTestId('cv-block-header'))
  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'B' } })
  fireEvent.click(screen.getByRole('button', { name: 'Cập nhật bản nháp' }))
}

describe('CV editor explicit save workflow', () => {
  it('renders exactly one PDF download action in the editor', async () => {
    renderBuilder()
    await screen.findByTestId('cv-editor')

    expect(screen.getAllByRole('button', { name: /tải pdf/i })).toHaveLength(1)
  })

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

  it('applies an accepted AI result locally, then explicitly saves one AI revision', async () => {
    const updated = { ...cv, sections: { ...cv.sections, intro: { ...cv.sections.intro, fullName: 'AI draft' } } }
    const sendChat = vi.spyOn(api, 'sendChat').mockResolvedValue({
      kind: 'patch', proposalId: 'proposal-1', summary: 'Đề xuất AI',
      ops: [{ op: 'replace', path: '/sections/intro/fullName', value: 'AI draft', rationale: 'Rõ hơn', grounding: { type: 'profile', ref: 'cv-1' } }],
      rejected: [],
    } as never)
    const settle = vi.spyOn(api, 'settleChatProposal').mockResolvedValue({
      applied: 1,
      status: 'accepted',
      selectedOps: [{ op: 'replace', path: '/sections/intro/fullName', value: 'AI draft', rationale: 'Rõ hơn', grounding: { type: 'profile', ref: 'cv-1' } }],
      accepted: [0],
      rejected: [],
    })
    const commit = vi.spyOn(api, 'commitCV').mockResolvedValue({ cv: envelope(updated) } as never)
    const legacySave = vi.spyOn(api, 'saveCV').mockResolvedValue(undefined)
    renderBuilder()

    fireEvent.click(await screen.findByRole('button', { name: 'Tạo tóm tắt' }))
    expect(sendChat).toHaveBeenCalled()
    await screen.findAllByText('Đề xuất AI')
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng vào CV' }))

    await waitFor(() => expect(screen.getByText('AI draft')).toBeInTheDocument())
    expect(settle).toHaveBeenCalledWith('proposal-1', 'profile-1', { cvId: 'cv-1', draftVersion: 1 }, [0])
    expect(legacySave).not.toHaveBeenCalled()
    expect(commit).not.toHaveBeenCalled()
    expect(screen.getByText('Chưa lưu', { exact: true })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }))

    await waitFor(() => expect(commit).toHaveBeenCalledWith('cv-1', expect.objectContaining({ sections: expect.objectContaining({ intro: expect.objectContaining({ fullName: 'AI draft' }) }) }), layout, 'ai', 'Đề xuất AI', 0))
  })

  it('keeps a newer manual edit when settlement resolves after that edit', async () => {
    const settlement = deferred<Awaited<ReturnType<typeof api.settleChatProposal>>>()
    vi.spyOn(api, 'sendChat').mockResolvedValue({
      kind: 'patch', proposalId: 'proposal-deferred', summary: 'Đề xuất trễ',
      ops: [{ op: 'replace', path: '/sections/intro/title', value: 'AI title', rationale: 'Rõ hơn', grounding: { type: 'profile', ref: 'cv-1' } }], rejected: [],
    } as never)
    vi.spyOn(api, 'settleChatProposal').mockReturnValue(settlement.promise)
    renderBuilder()

    fireEvent.click(await screen.findByRole('button', { name: 'Tạo tóm tắt' }))
    await screen.findAllByText('Đề xuất trễ')
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng vào CV' }))
    await waitFor(() => expect(api.settleChatProposal).toHaveBeenCalledTimes(1))
    await editName()

    await act(async () => settlement.resolve({ applied: 1, status: 'accepted', accepted: [0], rejected: [], selectedOps: [{ op: 'replace', path: '/sections/intro/title', value: 'AI title', rationale: 'Rõ hơn', grounding: { type: 'profile', ref: 'cv-1' } }] }))

    expect(within(screen.getByTestId('cv-block-header')).getByText('B', { exact: true })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Áp dụng vào CV' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/bản nháp đã thay đổi/i)
  })

  it('clears AI provenance after discard so a later manual save is user-sourced', async () => {
    vi.spyOn(api, 'sendChat').mockResolvedValue({
      kind: 'patch', proposalId: 'proposal-1', summary: 'AI suggestion',
      ops: [{ op: 'replace', path: '/sections/intro/fullName', value: 'AI draft', rationale: 'Rõ hơn', grounding: { type: 'profile', ref: 'cv-1' } }], rejected: [],
    } as never)
    vi.spyOn(api, 'settleChatProposal').mockResolvedValue({ applied: 1, status: 'accepted', accepted: [0], rejected: [], selectedOps: [{ op: 'replace', path: '/sections/intro/fullName', value: 'AI draft', rationale: 'Rõ hơn', grounding: { type: 'profile', ref: 'cv-1' } }] })
    const commit = vi.spyOn(api, 'commitCV').mockResolvedValue({ cv: envelope({ ...cv, sections: { ...cv.sections, intro: { ...cv.sections.intro, fullName: 'B' } } }) } as never)
    renderBuilder()
    fireEvent.click(await screen.findByRole('button', { name: 'Tạo tóm tắt' }))
    await screen.findAllByText('AI suggestion')
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng vào CV' }))
    await screen.findByText('AI draft')
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ thay đổi' }))
    await waitFor(() => expect(screen.queryByText('AI draft')).not.toBeInTheDocument())
    await editName()
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }))
    await waitFor(() => expect(commit).toHaveBeenCalledWith('cv-1', expect.objectContaining({ sections: expect.objectContaining({ intro: expect.objectContaining({ fullName: 'B' }) }) }), layout, 'user', undefined, 0))
  })

  it('combines provenance for multiple accepted AI changes in one explicit save', async () => {
    vi.spyOn(api, 'sendChat')
      .mockResolvedValueOnce({ kind: 'patch', proposalId: 'proposal-a', summary: 'AI A', ops: [{ op: 'replace', path: '/sections/intro/fullName', value: 'AI A', rationale: 'A', grounding: { type: 'profile', ref: 'cv-1' } }], rejected: [] } as never)
      .mockResolvedValueOnce({ kind: 'patch', proposalId: 'proposal-b', summary: 'AI B', ops: [{ op: 'replace', path: '/sections/intro/title', value: 'AI B', rationale: 'B', grounding: { type: 'profile', ref: 'cv-1' } }], rejected: [] } as never)
    vi.spyOn(api, 'settleChatProposal')
      .mockResolvedValueOnce({ applied: 1, status: 'accepted', accepted: [0], rejected: [], selectedOps: [{ op: 'replace', path: '/sections/intro/fullName', value: 'AI A', rationale: 'A', grounding: { type: 'profile', ref: 'cv-1' } }] })
      .mockResolvedValueOnce({ applied: 1, status: 'accepted', accepted: [0], rejected: [], selectedOps: [{ op: 'replace', path: '/sections/intro/title', value: 'AI B', rationale: 'B', grounding: { type: 'profile', ref: 'cv-1' } }] })
    const commit = vi.spyOn(api, 'commitCV').mockResolvedValue({ cv: envelope(cv) } as never)
    renderBuilder()
    fireEvent.click(await screen.findByRole('button', { name: 'Tạo tóm tắt' }))
    await screen.findAllByText('AI A')
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng vào CV' }))
    await screen.findAllByText('AI A')
    fireEvent.click(screen.getByRole('button', { name: 'Tạo tóm tắt' }))
    await screen.findAllByText('AI B')
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng vào CV' }))
    await waitFor(() => expect(screen.getAllByText('AI B').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }))
    await waitFor(() => expect(commit).toHaveBeenCalledWith('cv-1', expect.anything(), layout, 'ai', 'AI A\nAI B', 0))
  })

  it('requires an explicit Save, Discard, or Cancel decision before downloading a dirty draft', async () => {
    const commit = vi.spyOn(api, 'commitCV').mockResolvedValue({
      cv: envelope({ ...cv, sections: { ...cv.sections, intro: { ...cv.sections.intro, fullName: 'B' } } }),
    } as never)
    const print = spyOnPrint()
    renderBuilder()
    await editName()

    fireEvent.click(await screen.findByRole('button', { name: /tải pdf/i }))

    const dialog = screen.getByRole('dialog', { name: /xuất pdf với thay đổi chưa lưu/i })
    expect(commit).not.toHaveBeenCalled()
    expect(print).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: /lưu và tải/i }))
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1))
    expect(print).toHaveBeenCalledTimes(1)
  })

  it('can cancel download without changing the draft or discard it without committing', async () => {
    const commit = vi.spyOn(api, 'commitCV')
    const print = spyOnPrint()
    renderBuilder()
    await editName()

    fireEvent.click(screen.getByRole('button', { name: /tải pdf/i }))
    fireEvent.click(within(screen.getByRole('dialog', { name: /xuất pdf với thay đổi chưa lưu/i })).getByRole('button', { name: 'Hủy' }))
    expect(within(screen.getByTestId('cv-block-header')).getByText('B', { exact: true })).toBeInTheDocument()
    expect(print).not.toHaveBeenCalled()

    fireEvent.click(await screen.findByRole('button', { name: /tải pdf/i }))
    fireEvent.click(within(screen.getByRole('dialog', { name: /xuất pdf với thay đổi chưa lưu/i })).getByRole('button', { name: /bỏ thay đổi và tải/i }))
    expect(commit).not.toHaveBeenCalled()
    expect(print).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(within(screen.getByTestId('cv-block-header')).getByText('A', { exact: true })).toBeInTheDocument())
  })

  it('keeps AI provenance when a manual edit is mixed into the same draft', async () => {
    vi.spyOn(api, 'sendChat').mockResolvedValue({ kind: 'patch', proposalId: 'proposal-mixed', summary: 'AI mixed', ops: [{ op: 'replace', path: '/sections/intro/title', value: 'AI title', rationale: 'A', grounding: { type: 'profile', ref: 'cv-1' } }], rejected: [] } as never)
    vi.spyOn(api, 'settleChatProposal').mockResolvedValue({ applied: 1, status: 'accepted', accepted: [0], rejected: [], selectedOps: [{ op: 'replace', path: '/sections/intro/title', value: 'AI title', rationale: 'A', grounding: { type: 'profile', ref: 'cv-1' } }] })
    const commit = vi.spyOn(api, 'commitCV').mockResolvedValue({ cv: envelope(cv, 1), revision: { number: 1 } } as never)
    renderBuilder()
    fireEvent.click(await screen.findByRole('button', { name: 'Tạo tóm tắt' }))
    await screen.findAllByText('AI mixed')
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng vào CV' }))
    await waitFor(() => expect(screen.getByText('AI title')).toBeInTheDocument())
    await editName()
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }))
    await waitFor(() => expect(commit).toHaveBeenCalledWith('cv-1', expect.anything(), layout, 'ai', 'AI mixed', 0))
  })
})
