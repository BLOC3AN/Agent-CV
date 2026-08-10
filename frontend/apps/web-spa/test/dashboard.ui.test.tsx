import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router-dom'
import { DashboardRoute } from '../src/routes/DashboardRoute.js'
import * as api from '../src/lib/api.js'

const profileSnapshot = {
  id: 'profile-1', title: 'CV thật', lastModified: '2026-08-10',
  sections: { intro: { fullName: 'Người dùng thật', title: 'Engineer' }, experience: [], projects: [], education: [], skills: [], activities: [], certifications: [], languages: [] },
  design: { template: 'modern', accentColor: '#000', font: 'Roboto', fontSize: 14, spacing: 'normal' },
  activeSections: { intro: true, experience: true, projects: true, education: true, skills: true, activities: true, certifications: true, languages: true },
} as never

afterEach(() => vi.restoreAllMocks())

function renderRoute() {
  return render(<MemoryRouter><DashboardRoute /></MemoryRouter>)
}

describe('DashboardRoute', () => {
  it('hiện trạng thái chưa có CV thay vì dữ liệu demo', async () => {
    vi.spyOn(api, 'listCVs').mockResolvedValue([])
    renderRoute()
    expect(await screen.findByText('Bạn chưa có CV nào')).toBeInTheDocument()
    expect(screen.getByText('0%')).toBeInTheDocument()
  })

  it('hiện CV thật và phân biệt tài khoản có nhiều CV', async () => {
    vi.spyOn(api, 'listCVs').mockResolvedValue([
      { id: 'cv-1', title: 'CV thật', updatedAt: '2026-08-10' },
      { id: 'cv-2', title: 'CV thứ hai', updatedAt: '2026-08-10' },
    ])
    vi.spyOn(api, 'getCV').mockResolvedValue({ profileSnapshot } as never)
    renderRoute()
    expect(await screen.findByText('Người dùng thật')).toBeInTheDocument()
    expect(screen.getByText('2 CV đang được quản lý')).toBeInTheDocument()
  })

  it('nút Sửa CV ngay dùng cv document id để mở builder', async () => {
    vi.spyOn(api, 'listCVs').mockResolvedValue([{ id: 'cv-document-1', title: 'CV thật', updatedAt: '2026-08-10' }])
    vi.spyOn(api, 'getCV').mockResolvedValue({ profileSnapshot } as never)
    const router = createMemoryRouter([
      { path: '/', element: <DashboardRoute /> },
      { path: '/builder/:cvId', element: <div data-testid="builder-route">builder</div> },
    ], { initialEntries: ['/'] })
    render(<RouterProvider router={router} />)

    fireEvent.click(await screen.findByRole('button', { name: /sửa cv ngay/i }))
    expect(await screen.findByTestId('builder-route')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/builder/cv-document-1')
  })

  it('thumbnail Chỉnh sửa cũng dùng cv document id để mở builder', async () => {
    vi.spyOn(api, 'listCVs').mockResolvedValue([{ id: 'cv-document-1', title: 'CV thật', updatedAt: '2026-08-10' }])
    vi.spyOn(api, 'getCV').mockResolvedValue({ profileSnapshot } as never)
    const router = createMemoryRouter([
      { path: '/', element: <DashboardRoute /> },
      { path: '/builder/:cvId', element: <div data-testid="builder-route">builder</div> },
    ], { initialEntries: ['/'] })
    render(<RouterProvider router={router} />)

    fireEvent.click(await screen.findByText('Chỉnh sửa'))
    expect(await screen.findByTestId('builder-route')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/builder/cv-document-1')
  })
})
