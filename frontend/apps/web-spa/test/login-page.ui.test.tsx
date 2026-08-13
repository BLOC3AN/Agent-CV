import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LoginPage } from '../src/routes/LoginPage'
import { SessionProvider } from '../src/lib/session'

const { getSession, logout, requestLogin } = vi.hoisted(() => ({
  getSession: vi.fn(),
  logout: vi.fn(),
  requestLogin: vi.fn(),
}))

vi.mock('../src/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api')>()),
  getSession,
  logout,
  requestLogin,
}))

afterEach(() => vi.clearAllMocks())

function renderLogin() {
  return render(
    <MemoryRouter>
      <SessionProvider><LoginPage /></SessionProvider>
    </MemoryRouter>,
  )
}

describe('trang đăng nhập', () => {
  it('luôn có nút Google trỏ thẳng vào luồng OAuth của máy chủ', async () => {
    getSession.mockResolvedValue({ authenticated: false, magicLink: false })
    renderLogin()

    const link = await screen.findByRole('link', { name: /google/i })
    expect(link).toHaveAttribute('href', '/api/auth/google/start')
  })

  /*
   * Ở production magic link không gửi được thư — repo không có mailer. Hiện một
   * form không bao giờ dẫn tới đâu là mời người dùng vào ngõ cụt.
   */
  it('ẩn form magic link khi máy chủ báo không dùng được', async () => {
    getSession.mockResolvedValue({ authenticated: false, magicLink: false })
    renderLogin()

    await screen.findByRole('link', { name: /google/i })
    expect(screen.queryByLabelText('Email')).toBeNull()
  })

  it('hiện form magic link khi máy chủ báo dùng được', async () => {
    getSession.mockResolvedValue({ authenticated: false, magicLink: true })
    renderLogin()

    await waitFor(() => expect(screen.getByLabelText('Email')).toBeTruthy())
    expect(screen.getByRole('link', { name: /google/i })).toBeTruthy()
  })
})
