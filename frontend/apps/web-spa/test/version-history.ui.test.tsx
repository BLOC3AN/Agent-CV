import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BuilderRoute } from '../src/routes/BuilderRoute'
import * as api from '../src/lib/api'
import type { CV, CVLayout } from '../src/types'

const cv = {
  schemaVersion: 2, id: 'cv-1', language: 'vi', title: 'CV', lastModified: '',
  sections: { intro: { fullName: 'Current name', title: '', email: '', phone: '', location: '', summary: '' }, experience: [], projects: [], education: [], skills: [], activities: [], certifications: [], languages: [] },
  design: { template: 'modern', accentColor: '#000', font: 'Roboto', fontSize: 14, spacing: 'normal' },
  activeSections: { intro: true, experience: true, projects: true, education: true, skills: true, activities: true, certifications: true, languages: true },
  _meta: { verified: {}, source: 'manual', canonical: {} },
} as CV
const layout: CVLayout = { version: 1, nodes: [{ id: 'header', type: 'header', visible: true }] }
const envelope = (profileSnapshot = cv) => ({ id: 'cv-1', profileId: 'profile-1', layout, profileSnapshot } as never)
const revision = (id: string, number: number, source: api.CVRevisionSource, message?: string) => ({
  id, number, cvId: 'cv-1', source, message, createdAt: '2026-08-10T09:15:00.000Z',
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

afterEach(() => vi.restoreAllMocks())

function renderBuilder() {
  vi.spyOn(api, 'getCV').mockResolvedValue(envelope())
  const router = createMemoryRouter([{ path: '/builder/:cvId', element: <BuilderRoute /> }], { initialEntries: ['/builder/cv-1'] })
  render(<RouterProvider router={router} />)
}

async function openHistory() {
  fireEvent.click(await screen.findByRole('button', { name: 'Lịch sử phiên bản' }))
  return screen.findByRole('dialog', { name: 'Lịch sử phiên bản' })
}

async function editName() {
  await screen.findByTestId('cv-editor')
  fireEvent.click(screen.getAllByTitle('Chỉnh sửa phần này')[0]!)
  fireEvent.change(screen.getByDisplayValue('Current name'), { target: { value: 'Unsaved name' } })
}

describe('CV version history', () => {
  it('lists each revision with its source, time, and message', async () => {
    vi.spyOn(api, 'listCVRevisions').mockResolvedValue([
      revision('revision-5', 5, 'ai', 'AI rewrote the profile'),
      revision('revision-4', 4, 'user', 'Updated contact details'),
    ])
    renderBuilder()

    const dialog = await openHistory()
    expect(within(dialog).getByText('Phiên bản 5')).toBeInTheDocument()
    expect(within(dialog).getByText('AI')).toBeInTheDocument()
    expect(within(dialog).getAllByText(/10\/08\/2026/)).toHaveLength(2)
    expect(within(dialog).getByText('AI rewrote the profile')).toBeInTheDocument()
    expect(within(dialog).getByText('Người dùng')).toBeInTheDocument()
    expect(within(dialog).getByText('Updated contact details')).toBeInTheDocument()
  })

  it('shows the server-provided before and after documents for a revision', async () => {
    vi.spyOn(api, 'listCVRevisions').mockResolvedValue([revision('revision-5', 5, 'ai')])
    vi.spyOn(api, 'getCVRevision').mockResolvedValue({
      before: { profileSnapshot: { ...cv, sections: { ...cv.sections, intro: { ...cv.sections.intro, fullName: 'Before name' } } }, layout },
      revision: { ...revision('revision-5', 5, 'ai'), profileSnapshot: { ...cv, sections: { ...cv.sections, intro: { ...cv.sections.intro, fullName: 'After name' } } }, layout },
    } as never)
    renderBuilder()

    const dialog = await openHistory()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xem trước phiên bản 5' }))

    expect(await screen.findByText('Trước khi thay đổi')).toBeInTheDocument()
    expect(screen.getByText('Sau thay đổi')).toBeInTheDocument()
    expect(screen.getByText('Before name')).toBeInTheDocument()
    expect(screen.getByText('After name')).toBeInTheDocument()
  })

  it('keeps the latest selected revision when preview responses resolve out of order', async () => {
    const previewFive = deferred<Awaited<ReturnType<typeof api.getCVRevision>>>()
    const previewFour = deferred<Awaited<ReturnType<typeof api.getCVRevision>>>()
    vi.spyOn(api, 'listCVRevisions').mockResolvedValue([
      revision('revision-5', 5, 'ai'),
      revision('revision-4', 4, 'user'),
    ])
    vi.spyOn(api, 'getCVRevision').mockImplementation((_, revisionId) => revisionId === 'revision-5' ? previewFive.promise : previewFour.promise)
    renderBuilder()

    const dialog = await openHistory()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xem trước phiên bản 5' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xem trước phiên bản 4' }))
    expect(screen.getByText('Đang tải bản xem trước…')).toBeInTheDocument()

    await act(async () => previewFour.resolve({
      before: { profileSnapshot: { ...cv, sections: { ...cv.sections, intro: { ...cv.sections.intro, fullName: 'Before four' } } }, layout },
      revision: { ...revision('revision-4', 4, 'user'), profileSnapshot: { ...cv, sections: { ...cv.sections, intro: { ...cv.sections.intro, fullName: 'After four' } } }, layout },
    } as never))
    await act(async () => previewFive.resolve({
      before: { profileSnapshot: { ...cv, sections: { ...cv.sections, intro: { ...cv.sections.intro, fullName: 'Before five' } } }, layout },
      revision: { ...revision('revision-5', 5, 'ai'), profileSnapshot: { ...cv, sections: { ...cv.sections, intro: { ...cv.sections.intro, fullName: 'After five' } } }, layout },
    } as never))

    expect(await screen.findByText('After four')).toBeInTheDocument()
    expect(screen.getByText('Before four')).toBeInTheDocument()
    expect(screen.queryByText('After five')).not.toBeInTheDocument()
    expect(screen.queryByText('Before five')).not.toBeInTheDocument()
  })

  it('focuses history, traps Tab, and restores the invoker on Escape', async () => {
    vi.spyOn(api, 'listCVRevisions').mockResolvedValue([revision('revision-4', 4, 'user')])
    renderBuilder()
    const invoker = await screen.findByRole('button', { name: 'Lịch sử phiên bản' })
    fireEvent.click(invoker)

    const dialog = await screen.findByRole('dialog', { name: 'Lịch sử phiên bản' })
    const close = within(dialog).getByRole('button', { name: 'Đóng' })
    const preview = within(dialog).getByRole('button', { name: 'Xem trước phiên bản 4' })
    const last = within(dialog).getByRole('button', { name: 'Khôi phục phiên bản 4' })
    expect(document.activeElement).toBe(close)

    fireEvent.keyDown(close, { key: 'Tab' })
    expect(document.activeElement).toBe(preview)
    fireEvent.keyDown(preview, { key: 'Tab' })
    expect(document.activeElement).toBe(last)
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(close, { key: 'Escape' })

    expect(screen.queryByRole('dialog', { name: 'Lịch sử phiên bản' })).not.toBeInTheDocument()
    expect(document.activeElement).toBe(invoker)
  })

  it('moves focus into nested restore confirmation and isolates its background', async () => {
    vi.spyOn(api, 'listCVRevisions').mockResolvedValue([revision('revision-4', 4, 'user')])
    renderBuilder()
    await openHistory()
    const restore = screen.getByRole('button', { name: 'Khôi phục phiên bản 4' })
    fireEvent.click(restore)

    const confirmation = screen.getByRole('dialog', { name: 'Xác nhận khôi phục phiên bản' })
    const cancel = within(confirmation).getByRole('button', { name: 'Hủy' })
    const confirm = within(confirmation).getByRole('button', { name: 'Tạo phiên bản khôi phục' })
    expect(document.activeElement).toBe(cancel)
    const history = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Lịch sử phiên bản"]')
    expect(history).not.toBeNull()
    expect(history).toHaveAttribute('aria-hidden', 'true')
    expect(history).toHaveProperty('inert', true)

    fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(confirm)
    fireEvent.keyDown(confirm, { key: 'Tab' })
    expect(document.activeElement).toBe(cancel)
    fireEvent.keyDown(cancel, { key: 'Escape' })

    expect(screen.queryByRole('dialog', { name: 'Xác nhận khôi phục phiên bản' })).not.toBeInTheDocument()
    expect(document.activeElement).toBe(restore)
  })

  it('restores only after confirmation and server confirmation, creating a new restore revision', async () => {
    const restoring = deferred<api.CVCommitResult>()
    vi.spyOn(api, 'listCVRevisions').mockResolvedValue([revision('revision-4', 4, 'user')])
    const restore = vi.spyOn(api, 'restoreCVRevision').mockReturnValue(restoring.promise)
    renderBuilder()

    const dialog = await openHistory()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Khôi phục phiên bản 4' }))
    const confirmation = screen.getByRole('dialog', { name: 'Xác nhận khôi phục phiên bản' })
    expect(confirmation).toHaveTextContent(/tạo một phiên bản mới/i)
    expect(confirmation).toHaveTextContent(/giữ lại lịch sử/i)
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Tạo phiên bản khôi phục' }))
    expect(restore).toHaveBeenCalledWith('cv-1', 'revision-4')
    expect(screen.getByText('Current name')).toBeInTheDocument()

    await act(async () => restoring.resolve({
      cv: envelope({ ...cv, sections: { ...cv.sections, intro: { ...cv.sections.intro, fullName: 'Restored name' } } }),
      revision: { ...revision('revision-6', 6, 'restore'), profileSnapshot: cv, layout },
    } as never))

    expect(await screen.findByText('Restored name')).toBeInTheDocument()
    expect(screen.getByText('Đã lưu')).toBeInTheDocument()
  })

  it('opens history without replacing an unsaved draft', async () => {
    vi.spyOn(api, 'listCVRevisions').mockResolvedValue([revision('revision-4', 4, 'user')])
    renderBuilder()
    await editName()

    await openHistory()

    expect(screen.getByDisplayValue('Unsaved name')).toBeInTheDocument()
    expect(screen.getByText('Bản nháp chưa lưu')).toBeInTheDocument()
  })

  it('keeps the current document when the server rejects a restore', async () => {
    vi.spyOn(api, 'listCVRevisions').mockResolvedValue([revision('revision-4', 4, 'user')])
    vi.spyOn(api, 'restoreCVRevision').mockRejectedValue(new api.ApiError(500, 'Không thể khôi phục'))
    renderBuilder()

    const dialog = await openHistory()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Khôi phục phiên bản 4' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Xác nhận khôi phục phiên bản' })).getByRole('button', { name: 'Tạo phiên bản khôi phục' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Không thể khôi phục')
    expect(screen.getByText('Current name')).toBeInTheDocument()
  })
})
