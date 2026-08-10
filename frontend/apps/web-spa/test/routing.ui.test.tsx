import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { appRoutes } from '../src/routes/routes.js'
import * as api from '../src/lib/api.js'
import { initialCVs } from '../src/mockData'
import type { CV } from '../src/types'

function renderAt(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}

describe('bản đồ URL', () => {
  // Bản đồ URL nay nằm sau `RequireAuth` (Task 6) — test này không kiểm tra
  // đăng nhập, nên giả lập một phiên đã đăng nhập để tập trung vào routing.
  beforeEach(() => {
    vi.spyOn(api, 'getSession').mockResolvedValue({ authenticated: true, email: 'ha@example.com' })
    // `/cv` (Task 7) nạp dữ liệu thật qua `listCVs()`. Test này kiểm bản đồ
    // URL, không phải hành vi nạp dữ liệu — giả lập danh sách rỗng để tập
    // trung vào routing.
    vi.spyOn(api, 'listCVs').mockResolvedValue([])
  })

  afterEach(() => vi.restoreAllMocks())

  it('/ mở màn hình tổng quan', async () => {
    renderAt('/')
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(screen.getByTestId('view-dashboard')).toBeInTheDocument()
  })

  it('/cv mở danh sách CV', async () => {
    renderAt('/cv')
    expect(await screen.findByTestId('view-my-cvs')).toBeInTheDocument()
  })

  it('/templates mở kho mẫu', async () => {
    renderAt('/templates')
    expect(await screen.findByTestId('view-templates')).toBeInTheDocument()
  })

  it('/settings mở cài đặt', async () => {
    renderAt('/settings')
    expect(await screen.findByTestId('view-settings')).toBeInTheDocument()
  })

  it('URL không tồn tại hiện màn hình 404, không phải trang trắng', async () => {
    renderAt('/khong-co-that')
    expect(await screen.findByText(/không tìm thấy trang/i)).toBeInTheDocument()
  })

  it('mục sidebar tương ứng được đánh dấu đang mở', async () => {
    renderAt('/cv')
    const link = await screen.findByTestId('sidebar-item-cv')
    expect(link).toHaveAttribute('aria-current', 'page')
  })

  it('/analyze (không kèm id) mở màn hình đối chiếu việc làm — cùng màn hình với /analyze/:cvId', async () => {
    renderAt('/analyze')
    expect(await screen.findByTestId('view-job-match')).toBeInTheDocument()
  })

  it('/analyze/:cvId mở màn hình đối chiếu việc làm', async () => {
    renderAt('/analyze/cv-1')
    expect(await screen.findByTestId('view-job-match')).toBeInTheDocument()
  })

  it('/builder/:cvId mở trình soạn CV và ẩn hẳn sidebar', async () => {
    renderAt('/builder/cv-1')
    expect(await screen.findByTestId('view-editor')).toBeInTheDocument()
    expect(screen.queryByTestId('sidebar-item-cv')).not.toBeInTheDocument()
    expect(screen.queryByTestId('sidebar-item-dashboard')).not.toBeInTheDocument()
  })

  it('/builder/:cvId/preview mở preview nhiều trang thay vì 404', async () => {
    const envelope = {
      id: 'cv-1',
      profileId: 'profile-1',
      title: initialCVs[0]!.title,
      templateId: 'modern',
      theme: {},
      layout: {},
      language: 'en',
      updatedAt: initialCVs[0]!.lastModified,
      profileSnapshot: initialCVs[0]!,
      schemaVersion: 2,
    } as const
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ cv: envelope }), { status: 200 }),
    )
    renderAt('/builder/cv-1/preview')
    expect(await screen.findByText(/xem trước cv a4/i)).toBeInTheDocument()
    expect(screen.getByTestId('a4-document')).toBeInTheDocument()
    fetchMock.mockRestore()
  })

  it('keeps the structured editor workflow on the routed draft until explicit Save, including layout recovery, AI, restore, and discard', async () => {
    const firstExperience = { ...initialCVs[0]!.sections.experience[0]!, id: 'exp-1', title: 'First role', company: 'First company' }
    const secondExperience = { ...initialCVs[0]!.sections.experience[1]!, id: 'exp-2', title: 'Second role', company: 'Second company' }
    const structuredCV = {
      ...initialCVs[0]!,
      id: 'cv-structured',
      sections: {
        ...initialCVs[0]!.sections,
        intro: { ...initialCVs[0]!.sections.intro, fullName: 'Legacy candidate' },
        experience: [firstExperience, secondExperience],
      },
    } as CV
    const envelope = (profileSnapshot: CV, layout: unknown = {}) => ({
      id: 'cv-structured', profileId: 'profile-1', profileSnapshot, layout,
    } as never)
    const restoredCV = {
      ...structuredCV,
      sections: { ...structuredCV.sections, intro: { ...structuredCV.sections.intro, fullName: 'Restored candidate' } },
    }
    const commit = vi.spyOn(api, 'commitCV').mockResolvedValue({ cv: envelope(structuredCV) } as never)
    vi.spyOn(api, 'getCV').mockResolvedValue(envelope(structuredCV))
    vi.spyOn(api, 'sendChat').mockResolvedValue({
      kind: 'patch', proposalId: 'proposal-1', summary: 'AI summary', rejected: [],
      ops: [{ op: 'replace', path: '/sections/intro/fullName', value: 'AI candidate', rationale: 'Clearer', grounding: { type: 'profile', ref: 'cv-structured' } }],
    } as never)
    vi.spyOn(api, 'settleChatProposal').mockResolvedValue({
      applied: 1, status: 'accepted', accepted: [0], rejected: [],
      selectedOps: [{ op: 'replace', path: '/sections/intro/fullName', value: 'AI candidate', rationale: 'Clearer', grounding: { type: 'profile', ref: 'cv-structured' } }],
    })
    vi.spyOn(api, 'listCVRevisions').mockResolvedValue([
      { id: 'revision-1', number: 1, cvId: 'cv-structured', source: 'user', createdAt: '2026-08-10T09:15:00.000Z' },
    ])
    const restore = vi.spyOn(api, 'restoreCVRevision').mockResolvedValue({
      cv: envelope(restoredCV),
      revision: { id: 'revision-2', number: 2, cvId: 'cv-structured', source: 'restore', createdAt: '2026-08-10T09:16:00.000Z', profileSnapshot: restoredCV, layout: {} },
    } as never)

    const router = renderAt('/builder/cv-structured')
    await screen.findByTestId('cv-editor')

    const renderedNodeIds = () => [...document.querySelectorAll('[data-cv-node]')].map((node) => node.getAttribute('data-cv-node'))
    // A legacy empty layout is normalized in memory, not persisted, to the stable default order.
    expect(renderedNodeIds()[0]).toBe('header')
    expect(renderedNodeIds().at(-1)).toBe('footer')

    fireEvent.dragStart(screen.getByRole('button', { name: 'Kéo Footer' }))
    const headerRow = screen.getByRole('treeitem', { name: 'Thông tin cá nhân' })
    fireEvent.dragOver(headerRow)
    fireEvent.drop(headerRow)
    expect(renderedNodeIds().slice(0, 2)).toEqual(['footer', 'header'])

    fireEvent.click(screen.getByRole('button', { name: 'Mở rộng Kinh nghiệm làm việc' }))
    fireEvent.dragStart(screen.getByRole('button', { name: 'Kéo Second role — Second company' }))
    const firstExperienceRow = screen.getByRole('treeitem', { name: 'First role — First company' })
    fireEvent.dragOver(firstExperienceRow)
    fireEvent.drop(firstExperienceRow)
    expect([...screen.getByTestId('cv-block-experience').querySelectorAll('[data-cv-item-id]')].map((item) => item.getAttribute('data-cv-item-id'))).toEqual(['exp-2', 'exp-1'])

    fireEvent.click(screen.getByRole('button', { name: 'Ẩn Kinh nghiệm làm việc' }))
    expect(screen.queryByTestId('cv-block-experience')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Đặt lại mặc định' }))
    expect(renderedNodeIds()[0]).toBe('header')
    expect(screen.getByTestId('cv-block-experience')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }))
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1))
    expect(commit.mock.calls[0]?.slice(0, 4)).toEqual(['cv-structured', expect.anything(), expect.objectContaining({ version: 1 }), 'user'])

    fireEvent.click(screen.getByRole('button', { name: 'Tạo tóm tắt' }))
    await screen.findAllByText('AI summary')
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng vào CV' }))
    await screen.findByText('AI candidate')
    expect(commit).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }))
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(2))
    expect(commit.mock.calls[1]?.slice(0, 5)).toEqual(['cv-structured', expect.anything(), expect.anything(), 'ai', 'AI summary'])

    fireEvent.click(screen.getByRole('button', { name: 'Lịch sử phiên bản' }))
    const history = await screen.findByRole('dialog', { name: 'Lịch sử phiên bản' })
    fireEvent.click(within(history).getByRole('button', { name: 'Khôi phục phiên bản 1' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Xác nhận khôi phục phiên bản' })).getByRole('button', { name: 'Tạo phiên bản khôi phục' }))
    await waitFor(() => expect(restore).toHaveBeenCalledWith('cv-structured', 'revision-1'))
    expect(await screen.findByText('Restored candidate')).toBeInTheDocument()

    fireEvent.click(screen.getAllByTitle('Chỉnh sửa phần này')[0]!)
    fireEvent.change(screen.getByDisplayValue('Restored candidate'), { target: { value: 'Discarded candidate' } })
    await act(async () => { await router.navigate('/cv') })
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Thay đổi chưa lưu' })).getByRole('button', { name: 'Bỏ thay đổi' }))
    expect(await screen.findByTestId('view-my-cvs')).toBeInTheDocument()
  })
})
