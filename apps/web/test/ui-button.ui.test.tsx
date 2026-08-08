import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from '@/components/ui'

/**
 * FRONTEND §8.1: khi model server chết, nút cần AI phải MỜ ĐI kèm lời giải
 * thích, KHÔNG được biến mất — biến mất khiến người dùng tưởng mình vừa thao
 * tác sai và thử lại nhiều lần.
 */

afterEach(() => vi.restoreAllMocks())

describe('Button', () => {
  it('bấm được và gọi onClick', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Tiếp tục</Button>)
    await userEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('disabled thì không gọi onClick', async () => {
    const onClick = vi.fn()
    render(
      <Button disabled disabledReason="Trợ lý AI đang tạm ngưng" onClick={onClick}>
        Cùng tôi sửa
      </Button>,
    )
    await userEvent.click(screen.getByRole('button', { name: /Cùng tôi sửa/ }))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('nút vẫn CÓ MẶT khi disabled — không biến mất', () => {
    render(
      <Button disabled disabledReason="Trợ lý AI đang tạm ngưng">Cùng tôi sửa</Button>,
    )
    expect(screen.getByRole('button', { name: /Cùng tôi sửa/ })).toBeInTheDocument()
  })

  it('lý do disabled đọc được qua aria-describedby', () => {
    render(
      <Button disabled disabledReason="Trợ lý AI đang tạm ngưng">Cùng tôi sửa</Button>,
    )
    const btn = screen.getByRole('button', { name: /Cùng tôi sửa/ })
    const id = btn.getAttribute('aria-describedby')
    expect(id).toBeTruthy()
    expect(document.getElementById(id!)?.textContent).toBe('Trợ lý AI đang tạm ngưng')
  })

  it('disabled mà THIẾU lý do: vẫn render, nhưng cảnh báo ở dev', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<Button disabled>Cùng tôi sửa</Button>)
    expect(screen.getByRole('button', { name: 'Cùng tôi sửa' })).toBeInTheDocument()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('disabledReason'))
  })

  it('không disabled thì không có aria-describedby thừa', () => {
    render(<Button>Tiếp tục</Button>)
    expect(screen.getByRole('button', { name: 'Tiếp tục' })).not.toHaveAttribute(
      'aria-describedby',
    )
  })

  it('mặc định type là "button"', () => {
    render(<Button>Bấm tôi</Button>)
    expect(screen.getByRole('button', { name: 'Bấm tôi' })).toHaveAttribute('type', 'button')
  })

  it('nút bên trong form không submit form khi bấm (mặc định type="button")', async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <Button>Không submit</Button>
      </form>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Không submit' }))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('truyền type="submit" tường minh thì vẫn submit form', async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit">Gửi form</Button>
      </form>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Gửi form' }))
    expect(onSubmit).toHaveBeenCalledOnce()
  })
})
