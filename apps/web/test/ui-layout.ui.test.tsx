import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Card, Section, Badge } from '@/components/ui'

/**
 * FRONTEND §9.8: màu KHÔNG được là kênh thông tin duy nhất. Người mù màu và
 * ảnh chụp màn hình đen trắng phải đọc được cùng một thông tin.
 */

describe('Section', () => {
  it('tiêu đề là heading thật, không phải div tô đậm', () => {
    render(<Section title="Đối chiếu gần đây"><p>nội dung</p></Section>)
    expect(screen.getByRole('heading', { name: 'Đối chiếu gần đây' })).toBeInTheDocument()
  })

  it('hiện hành động phụ khi được truyền', () => {
    render(
      <Section title="Đối chiếu gần đây" action={<a href="/cv">Xem tất cả</a>}>
        <p>nội dung</p>
      </Section>,
    )
    expect(screen.getByRole('link', { name: 'Xem tất cả' })).toBeInTheDocument()
  })
})

describe('Badge', () => {
  it('luôn kèm CHỮ, không chỉ có màu', () => {
    render(<Badge tone="warn" icon="⚠">Cần kiểm tra</Badge>)
    expect(screen.getByText('Cần kiểm tra')).toBeInTheDocument()
  })

  it('icon được ẩn khỏi trình đọc màn hình — chữ đã mang nghĩa rồi', () => {
    const { container } = render(<Badge tone="success" icon="✓">Đã xác nhận</Badge>)
    expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe('✓')
  })
})

describe('Card', () => {
  it('render nội dung con', () => {
    render(<Card><p>xin chào</p></Card>)
    expect(screen.getByText('xin chào')).toBeInTheDocument()
  })

  it('biến thể ai đánh dấu được để test khác kiểm chữ ký AI', () => {
    const { container } = render(<Card variant="ai"><p>đề xuất</p></Card>)
    expect(container.querySelector('[data-variant="ai"]')).toBeInTheDocument()
  })
})
