import '@testing-library/jest-dom/vitest'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { appRoutes } from '../src/routes/routes.js'

function renderAt(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  return render(<RouterProvider router={router} />)
}

describe('bản đồ URL', () => {
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
})
