import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sheet, Button } from '@/components/ui'

/**
 * Slide-over cho chat tư vấn — FRONTEND §3.1 chọn "đè lên" thay vì pane thứ ba
 * vì laptop 1366×768 không đủ chỗ cho ba cột.
 *
 * Cùng bộ ràng buộc a11y như Dialog: nó cũng là lớp phủ chặn nền.
 */

function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Trợ lý</Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Chat tư vấn">
        <p>xin chào</p>
        <Button onClick={() => setOpen(false)}>Đóng</Button>
      </Sheet>
    </>
  )
}

describe('Sheet', () => {
  it('đóng thì không render gì', () => {
    render(<Sheet open={false} onClose={vi.fn()} title="T"><p>x</p></Sheet>)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('mở thì là dialog có tên đọc được', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Trợ lý' }))
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Chat tư vấn')
  })

  it('Escape đóng và trả focus về nút đã mở', async () => {
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Trợ lý' })
    await userEvent.click(opener)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(opener)
  })

  it('có nút đóng hiện rõ — không bắt người dùng đoán', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Trợ lý' }))
    expect(screen.getByRole('button', { name: /Đóng bảng/ })).toBeInTheDocument()
  })

  it('Tab không thoát ra nền', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Trợ lý' }))
    const dlg = screen.getByRole('dialog')
    for (let i = 0; i < 6; i++) await userEvent.tab()
    expect(dlg.contains(document.activeElement)).toBe(true)
  })
})
