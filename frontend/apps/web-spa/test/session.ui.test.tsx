import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { appRoutes } from '../src/routes/routes.js'
import * as api from '../src/lib/api.js'

function renderAt(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  return render(<RouterProvider router={router} />)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('chặn route khi chưa đăng nhập', () => {
  it('chưa đăng nhập thì /cv chuyển sang màn hình đăng nhập', async () => {
    vi.spyOn(api, 'getSession').mockResolvedValue({ authenticated: false })

    renderAt('/cv')

    expect(await screen.findByRole('heading', { name: /đăng nhập/i })).toBeInTheDocument()
  })

  it('đang hỏi phiên thì hiện trạng thái chờ, không chớp màn hình đăng nhập', async () => {
    // Phiên chưa trả lời — nếu guard mặc định là "chưa đăng nhập", người dùng
    // đã đăng nhập sẽ thấy màn hình đăng nhập nhấp nháy mỗi lần tải trang.
    vi.spyOn(api, 'getSession').mockReturnValue(new Promise(() => {}))

    renderAt('/cv')

    expect(await screen.findByTestId('session-loading')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /đăng nhập/i })).not.toBeInTheDocument()
  })

  it('đã đăng nhập thì vào thẳng và Header hiện email thật', async () => {
    vi.spyOn(api, 'getSession').mockResolvedValue({ authenticated: true, email: 'ha@example.com' })
    vi.spyOn(api, 'listCVs').mockResolvedValue([])

    renderAt('/cv')

    expect(await screen.findByTestId('view-my-cvs')).toBeInTheDocument()
    expect(screen.getByText('ha@example.com')).toBeInTheDocument()
  })
})

describe('màn hình đăng nhập', () => {
  it('gửi email và báo đã gửi link', async () => {
    vi.spyOn(api, 'getSession').mockResolvedValue({ authenticated: false })
    const send = vi.spyOn(api, 'requestLogin').mockResolvedValue({ ok: true })

    renderAt('/login')
    await userEvent.type(await screen.findByLabelText(/email/i), 'ha@example.com')
    await userEvent.click(screen.getByRole('button', { name: /gửi link đăng nhập/i }))

    expect(send).toHaveBeenCalledWith('ha@example.com')
    expect(await screen.findByText(/đã gửi link đăng nhập/i)).toBeInTheDocument()
  })

  it('backend trả devLink thì hiện link bấm được để chạy thử', async () => {
    vi.spyOn(api, 'getSession').mockResolvedValue({ authenticated: false })
    vi.spyOn(api, 'requestLogin').mockResolvedValue({
      ok: true,
      devLink: 'http://localhost:3002/api/auth/verify?token=abc',
    })

    renderAt('/login')
    await userEvent.type(await screen.findByLabelText(/email/i), 'ha@example.com')
    await userEvent.click(screen.getByRole('button', { name: /gửi link đăng nhập/i }))

    expect(await screen.findByRole('link', { name: /mở link đăng nhập/i })).toHaveAttribute(
      'href',
      'http://localhost:3002/api/auth/verify?token=abc',
    )
  })

  it('gửi hỏng thì hiện lỗi và giữ nguyên email đã nhập', async () => {
    vi.spyOn(api, 'getSession').mockResolvedValue({ authenticated: false })
    vi.spyOn(api, 'requestLogin').mockRejectedValue(new api.ApiError(400, 'Email không hợp lệ'))

    renderAt('/login')
    const input = await screen.findByLabelText(/email/i)
    await userEvent.type(input, 'sai')
    await userEvent.click(screen.getByRole('button', { name: /gửi link đăng nhập/i }))

    expect(await screen.findByText('Email không hợp lệ')).toBeInTheDocument()
    expect(input).toHaveValue('sai')
  })
})
