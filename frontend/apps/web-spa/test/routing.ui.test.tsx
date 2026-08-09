import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { appRoutes } from '../src/routes/routes.js'
import * as api from '../src/lib/api.js'

function renderAt(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  return render(<RouterProvider router={router} />)
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
})
