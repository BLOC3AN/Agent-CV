import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
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

/** Ba nút hiện — khoá hành vi vòng Tab qua NHIỀU phần tử, không phải một. */
function MultiHarness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Mở đề xuất</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="AI đề xuất 3 thay đổi">
        <Button>A</Button>
        <Button>B</Button>
        <Button>C</Button>
      </Dialog>
    </>
  )
}

/**
 * Nút ẩn bằng CSS (`display:none`) đặt CUỐI CÙNG — khoá việc `items()` lọc
 * theo hiển thị thật (`checkVisibility`), không chỉ theo `disabled`.
 *
 * Vị trí "cuối cùng" là cố ý: bẫy chỉ can thiệp ở BIÊN (phần tử đầu/cuối của
 * danh sách focus được), còn Tab giữa hai phần tử hiện thì để trình duyệt xử
 * lý mặc định — trình duyệt vốn đã bỏ qua `display:none`. Nếu không lọc,
 * `items()` coi nút ẩn là phần tử cuối (lastEl); khi Tab từ B — phần tử hiện
 * cuối cùng thật sự — bẫy không còn nhận ra đó là biên (vì lastEl trỏ vào nút
 * ẩn) nên không chặn lại, và trình duyệt sẽ Tab tiếp ra ngoài lớp phủ vì nút
 * ẩn không nhận được focus. Đặt nút ẩn xen giữa hai nút hiện (thử ban đầu)
 * không lộ ra lỗi này, vì khi đó cả hai nhánh biên đều trỏ đúng vào phần tử
 * hiện, nên "xanh giả" bất kể có lọc hay không.
 */
function HiddenElementHarness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Mở đề xuất</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="AI đề xuất 3 thay đổi">
        <Button>A</Button>
        <Button>B</Button>
        <Button style={{ display: 'none' }}>Ẩn</Button>
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

  it('Tab vòng thuận qua nhiều phần tử: A→B→C→A', async () => {
    render(<MultiHarness />)
    await userEvent.click(screen.getByRole('button', { name: 'Mở đề xuất' }))
    const a = screen.getByRole('button', { name: 'A' })
    const b = screen.getByRole('button', { name: 'B' })
    const c = screen.getByRole('button', { name: 'C' })

    expect(document.activeElement).toBe(a)
    await userEvent.tab()
    expect(document.activeElement).toBe(b)
    await userEvent.tab()
    expect(document.activeElement).toBe(c)
    await userEvent.tab()
    expect(document.activeElement).toBe(a)
  })

  it('Shift+Tab đi lùi và vòng lại: A→C→B', async () => {
    render(<MultiHarness />)
    await userEvent.click(screen.getByRole('button', { name: 'Mở đề xuất' }))
    const a = screen.getByRole('button', { name: 'A' })
    const b = screen.getByRole('button', { name: 'B' })
    const c = screen.getByRole('button', { name: 'C' })

    expect(document.activeElement).toBe(a)
    await userEvent.tab({ shift: true })
    expect(document.activeElement).toBe(c)
    await userEvent.tab({ shift: true })
    expect(document.activeElement).toBe(b)
  })

  it('phần tử ẩn bằng CSS không nằm trong vòng Tab', async () => {
    render(<HiddenElementHarness />)
    await userEvent.click(screen.getByRole('button', { name: 'Mở đề xuất' }))
    const dlg = screen.getByRole('dialog')
    const a = screen.getByRole('button', { name: 'A' })
    const b = screen.getByRole('button', { name: 'B' })
    // `role: 'button'` bỏ qua phần tử display:none dù truyền `hidden: true`
    // vì tên truy cập của nó rỗng — lấy trực tiếp qua text để không phụ
    // thuộc vào cách RTL tính "accessible name" cho phần tử ẩn.
    const hidden = within(dlg).getByText('Ẩn', { selector: 'button' })

    expect(document.activeElement).toBe(a)
    await userEvent.tab()
    expect(document.activeElement).toBe(b)
    expect(document.activeElement).not.toBe(hidden)
    await userEvent.tab()
    expect(document.activeElement).toBe(a)
  })
})
