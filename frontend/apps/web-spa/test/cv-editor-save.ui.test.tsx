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
const envelope = (profileSnapshot = cv) => ({ id: 'cv-1', profileId: '', layout, profileSnapshot } as never)

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
})
