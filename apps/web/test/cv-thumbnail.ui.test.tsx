import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProfileSchema, type Profile } from '@hr/schema'
import { CvThumbnail } from '@/components/cv/CvThumbnail'

/**
 * Bản CV thu nhỏ — FRONTEND §9.3, nơi dùng thứ ba của cùng một component
 * template.
 *
 * Thumbnail xuất hiện ở Home và danh sách CV, tức là trên đường đi của MỌI
 * người dùng. Hồ sơ mới tạo thì hầu hết mục còn trống, nên "không nổ với hồ sơ
 * rỗng" là yêu cầu chính, không phải trường hợp biên.
 */

const p = (over: Partial<Profile> = {}): Profile =>
  ProfileSchema.parse({
    schemaVersion: 1,
    language: 'vi',
    basics: { name: 'Nguyễn Văn A' },
    ...over,
  })

describe('CvThumbnail', () => {
  it('render nội dung hồ sơ', () => {
    render(<CvThumbnail profile={p()} />)
    expect(screen.getByText('Nguyễn Văn A')).toBeInTheDocument()
  })

  it('hồ sơ chỉ có tên, mọi mục khác trống → không nổ', () => {
    expect(() => render(<CvThumbnail profile={p()} />)).not.toThrow()
  })

  it('hồ sơ nhiều mục → không nổ', () => {
    const full = p({
      work: [{ org: 'Cty X', role: 'Dev', highlights: ['Xây dựng API'] }],
      projects: [{ name: 'Dự án A', highlights: ['Làm web'] }],
      education: [{ school: 'ĐH Bách Khoa', degree: 'Kỹ sư' }],
      // Fixture của brief dùng dạng { group, items } — không khớp SkillSchema
      // thật (mỗi skill là một object có `name`, `group` chỉ là nhãn tuỳ
      // chọn trên từng phần tử). Sửa lại cho khớp @hr/schema.
      skills: [
        { name: 'TypeScript', group: 'Ngôn ngữ' },
        { name: 'Go', group: 'Ngôn ngữ' },
      ],
    } as Partial<Profile>)
    expect(() => render(<CvThumbnail profile={full} />)).not.toThrow()
  })

  it('ẩn khỏi trình đọc màn hình — đây là hình minh hoạ, không phải nội dung', () => {
    const { container } = render(<CvThumbnail profile={p()} />)
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
  })

  it('dùng variant thumbnail của template', () => {
    const { container } = render(<CvThumbnail profile={p()} />)
    expect(container.querySelector('[data-variant="thumbnail"]')).toBeInTheDocument()
  })

  it('chiều rộng tuỳ chỉnh được', () => {
    const { container } = render(<CvThumbnail profile={p()} width={240} />)
    expect((container.firstElementChild as HTMLElement).style.width).toBe('240px')
  })
})
