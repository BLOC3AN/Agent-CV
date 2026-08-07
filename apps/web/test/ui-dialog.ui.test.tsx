import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Dialog, Button } from '@/components/ui'

/**
 * Modal là chỗ dễ bỏ quên a11y nhất, và PatchReviewModal — thứ chặn MỌI thay
 * đổi từ AI — đang thiếu đủ bốn thứ: Escape, bẫy focus, trả focus, khoá cuộn.
 * Người dùng bàn phím mở nó ra là lạc, không có cách nào quay lại.
 */

function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Mở đề xuất</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="AI đề xuất 3 thay đổi">
        <p>nội dung đề xuất</p>
        <Button onClick={() => setOpen(false)}>Áp dụng</Button>
      </Dialog>
    </>
  )
}

describe('Dialog', () => {
  it('đóng thì không render gì', () => {
    render(<Dialog open={false} onClose={vi.fn()} title="T"><p>x</p></Dialog>)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('mở thì có role dialog, aria-modal, và được đặt tên bằng tiêu đề', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Mở đề xuất' }))
    const dlg = screen.getByRole('dialog')
    expect(dlg).toHaveAttribute('aria-modal', 'true')
    expect(dlg).toHaveAccessibleName('AI đề xuất 3 thay đổi')
  })

  it('Escape đóng lại', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Mở đề xuất' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('focus chuyển VÀO trong khi mở', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Mở đề xuất' }))
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
  })

  it('TRẢ focus về nút đã mở nó khi đóng', async () => {
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Mở đề xuất' })
    await userEvent.click(opener)
    await userEvent.keyboard('{Escape}')
    expect(document.activeElement).toBe(opener)
  })

  it('Tab không thoát ra ngoài lớp phủ', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Mở đề xuất' }))
    const dlg = screen.getByRole('dialog')
    // Bấm Tab nhiều hơn số phần tử focus được bên trong: nếu không bẫy,
    // focus sẽ trôi ra nút "Mở đề xuất" ở nền.
    for (let i = 0; i < 6; i++) await userEvent.tab()
    expect(dlg.contains(document.activeElement)).toBe(true)
  })

  it('khoá cuộn nền khi mở, trả lại khi đóng', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Mở đề xuất' }))
    expect(document.body.style.overflow).toBe('hidden')
    await userEvent.keyboard('{Escape}')
    expect(document.body.style.overflow).toBe('')
  })
})
