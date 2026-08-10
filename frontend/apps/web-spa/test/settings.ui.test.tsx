import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { SettingsRoute } from '../src/routes/SettingsRoute.js'
import * as api from '../src/lib/api.js'

vi.mock('../src/lib/session.js', () => ({
  useSession: () => ({ email: 'ha@example.com', signOut: vi.fn() }),
}))

afterEach(() => vi.restoreAllMocks())

describe('SettingsRoute', () => {
  it('requires the exact account email before deleting', async () => {
    const remove = vi.spyOn(api, 'deleteAccount').mockResolvedValue(undefined)
    render(<MemoryRouter><SettingsRoute /></MemoryRouter>)
    const input = screen.getByLabelText(/nhập email/i)
    await userEvent.type(input, 'wrong@example.com')
    await userEvent.click(screen.getByRole('button', { name: /xoá tài khoản/i }))
    expect(remove).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/trùng chính xác/i)
    await userEvent.clear(input)
    await userEvent.type(input, 'ha@example.com')
    await userEvent.click(screen.getByRole('button', { name: /xoá tài khoản/i }))
    expect(remove).toHaveBeenCalledWith('ha@example.com')
  })
})
