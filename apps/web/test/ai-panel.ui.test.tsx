import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AiPanel } from '@/components/ai/AiPanel'
import { Button } from '@/components/ui'

/**
 * TDD §3.2 A7 — degrade, đừng sập. Model server KHÔNG có SLA.
 *
 * Spec §5.1 làm khối AI to và có chữ ký thị giác riêng. Hệ quả bắt buộc: khi
 * model chết, khối lộng lẫy nhất màn hình sẽ thành khối rỗng nhất nếu không
 * thiết kế trạng thái này. FRONTEND §8.1: nút cần AI phải MỜ ĐI kèm giải
 * thích, KHÔNG biến mất.
 */

describe('AiPanel — khi trợ lý sống', () => {
  it('hiện nội dung và hành động', () => {
    render(
      <AiPanel available actions={<Button>Cùng tôi sửa</Button>}>
        <p>Thêm số liệu vào các gạch đầu dòng</p>
      </AiPanel>,
    )
    expect(screen.getByText('Thêm số liệu vào các gạch đầu dòng')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cùng tôi sửa' })).toBeEnabled()
  })

  it('mang chữ ký thị giác của AI', () => {
    const { container } = render(<AiPanel available><p>x</p></AiPanel>)
    expect(container.querySelector('[data-variant="ai"]')).toBeInTheDocument()
  })

  it('đang stream thì báo cho trình đọc màn hình biết vùng này đang đổi', () => {
    render(<AiPanel available streaming><p>đang soạn…</p></AiPanel>)
    expect(screen.getByText('đang soạn…').closest('[aria-live]'))
      .toHaveAttribute('aria-live', 'polite')
  })
})

describe('AiPanel — khi trợ lý chết', () => {
  it('KHỐI VẪN CÒN, không biến mất', () => {
    render(<AiPanel available={false}><p>nội dung</p></AiPanel>)
    expect(screen.getByText(/tạm ngưng/)).toBeInTheDocument()
  })

  it('nói rõ việc gì VẪN LÀM ĐƯỢC', () => {
    render(<AiPanel available={false}><p>nội dung</p></AiPanel>)
    expect(screen.getByText(/vẫn sửa CV, đổi mẫu và tải file/)).toBeInTheDocument()
  })

  it('bỏ chữ ký AI — không giả vờ còn sống', () => {
    const { container } = render(<AiPanel available={false}><p>x</p></AiPanel>)
    expect(container.querySelector('[data-variant="ai"]')).not.toBeInTheDocument()
  })

  it('không hiện nội dung AI cũ như thể nó vừa được sinh ra', () => {
    render(<AiPanel available={false}><p>gợi ý cũ</p></AiPanel>)
    expect(screen.queryByText('gợi ý cũ')).not.toBeInTheDocument()
  })

  it('có nút Thử lại khi được truyền onRetry', async () => {
    const onRetry = vi.fn()
    render(<AiPanel available={false} onRetry={onRetry}><p>x</p></AiPanel>)
    await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
