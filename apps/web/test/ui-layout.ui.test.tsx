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

  /**
   * Bảo vệ hợp đồng TONE: cả 5 tông phải render được kèm chữ + icon ẩn.
   * Nếu ai xoá nhầm một nhánh từ TONE record, hoặc gõ sai tên tông, test sẽ
   * bắt được — đây là tuỳ từng tông, không phải kiểm hằng số.
   */
  it.each<Parameters<typeof Badge>[0]['tone']>(['neutral', 'success', 'warn', 'danger', 'ai'])(
    'tông %s render được với chữ + icon ẩn',
    (tone) => {
      const { container } = render(
        <Badge tone={tone} icon="◆">
          Trạng thái
        </Badge>,
      )
      expect(screen.getByText('Trạng thái')).toBeInTheDocument()
      expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe('◆')
    },
  )
})

describe('Card', () => {
  it('render nội dung con', () => {
    render(<Card><p>xin chào</p></Card>)
    expect(screen.getByText('xin chào')).toBeInTheDocument()
  })

  /**
   * Bảo vệ hợp đồng VARIANT: cả 3 biến thể phải render với data-variant đúng.
   * Nếu ai xoá nhầm một nhánh từ VARIANT record hoặc TypeScript được sửa để
   * bỏ qua invalid variant, test sẽ bắt được.
   */
  it.each<Parameters<typeof Card>[0]['variant']>(['default', 'ai', 'raised'])(
    'biến thể "%s" đánh dấu data-variant đúng',
    (variant) => {
      const { container } = render(<Card variant={variant}><p>nội dung</p></Card>)
      expect(container.querySelector(`[data-variant="${variant}"]`)).toBeInTheDocument()
    },
  )

  /**
   * Chữ ký thị giác của AI (spec §5.1): CHỈ biến thể `ai` có dải gradient 3px phía trên.
   * `default` và `raised` KHÔNG được có phần tử aria-hidden nào (tức không có gradient).
   *
   * Nguy hiểm: nếu ai đó vô tình thêm gradient vào `raised`, card raised sẽ trông
   * như card AI — những người dùng sẽ nhầm raised lẫn với AI.
   */
  it('CHỈ ai có dải gradient, default và raised không có', () => {
    const { container: defaultCard } = render(<Card variant="default"><p>thử</p></Card>)
    const { container: raisedCard } = render(<Card variant="raised"><p>thử</p></Card>)
    const { container: aiCard } = render(<Card variant="ai"><p>thử</p></Card>)

    // default: không có phần tử aria-hidden nào (không có gradient)
    expect(defaultCard.querySelector('[aria-hidden="true"]')).toBeNull()

    // raised: không có phần tử aria-hidden nào (không có gradient)
    expect(raisedCard.querySelector('[aria-hidden="true"]')).toBeNull()

    // ai: có phần tử aria-hidden (đó là gradient)
    expect(aiCard.querySelector('[aria-hidden="true"]')).toBeInTheDocument()
  })
})
