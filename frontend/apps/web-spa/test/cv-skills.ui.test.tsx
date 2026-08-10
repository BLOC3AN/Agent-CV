import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { CVEditorView } from '../src/components/CVEditorView'
import { PreviewModal } from '../src/components/PreviewModal'
import { initialCVs } from '../src/mockData'

const noop = () => {}

/**
 * `SkillItem.skills` phải là MẢNG chuỗi, khớp `SkillItemSchema` của CV v2
 * (packages/schema/src/cv.ts: `skills: z.array(z.string())`).
 *
 * Task 8 đổi `description` thành `highlights[]` nhưng bỏ quên `skills`. Prompt
 * v2 (backend/internal/api/server.go) DẠY model sinh `/sections/skills/0/skills/-`,
 * và `validateChatProposal` từ chối thẳng nếu `skills` không phải mảng — nên khi
 * SP-3+ nối SPA vào API v2, mọi patch kỹ năng hoặc lỗi hoặc làm hỏng state của
 * SPA. Sửa lúc còn là dữ liệu giả thì không ai mất gì.
 *
 * Không import @hr/schema ở đây: tsconfig của web-spa không khai path cho nó,
 * thêm vào là kéo cả một quyết định phụ thuộc mới vào một task sửa lỗi.
 */
describe('kỹ năng của SPA là mảng chuỗi, không phải chuỗi nối bằng dấu phẩy', () => {
  const skillGroups = initialCVs.flatMap((cv) => cv.sections.skills)

  it('có dữ liệu giả để kiểm', () => {
    expect(skillGroups.length).toBeGreaterThan(0)
  })

  it('mỗi nhóm giữ skills dưới dạng mảng chuỗi', () => {
    for (const group of skillGroups) {
      expect(Array.isArray(group.skills)).toBe(true)
      for (const skill of group.skills) expect(typeof skill).toBe('string')
    }
  })

  it('không phần tử nào còn là nhiều kỹ năng dồn trong một chuỗi', () => {
    for (const group of skillGroups) {
      for (const skill of group.skills) expect(skill).not.toContain(',')
    }
  })
})

describe('kỹ năng hiển thị y như cũ sau khi đổi kiểu', () => {
  const cv = initialCVs[0]!
  const expected = cv.sections.skills.map((g) => g.skills.join(', '))

  it('khay xem trước trong trình sửa vẫn hiện danh sách ngăn bằng ", "', () => {
    const { container } = render(
      <CVEditorView
        cv={cv}
        onUpdateCV={noop}
        onOpenPreview={noop}
        onOpenShare={noop}
        onDownloadPDF={noop}
      />,
    )
    for (const line of expected) expect(container.textContent).toContain(line)
  })

  it('PreviewModal cũng vậy', () => {
    const { container } = render(
      <PreviewModal isOpen cv={cv} onClose={noop} onDownloadPDF={noop} />,
    )
    for (const line of expected) expect(container.textContent).toContain(line)
  })
})

describe('bullet dự án xuống dòng như PreviewModal', () => {
  // PreviewModal nối bằng '\n' dưới `whitespace-pre-line`; trình sửa nối bằng
  // ' ' nên hai gạch đầu dòng dính thành một câu. Cùng dữ liệu, hai kết quả —
  // và bản in ra PDF là bản người dùng gửi đi.
  it('mỗi gạch đầu dòng của dự án nằm trên một dòng riêng trong trình sửa', () => {
    const cv = initialCVs[0]!
    const project = cv.sections.projects[0]!
    expect(project.highlights.length).toBeGreaterThan(1)

    const { container } = render(
      <CVEditorView
        cv={cv}
        onUpdateCV={noop}
        onOpenPreview={noop}
        onOpenShare={noop}
        onDownloadPDF={noop}
      />,
    )
    const renderedBullets = [...container.querySelectorAll('[data-cv-node="projects"] .cv-bullets li')].map(
      (el) => el.textContent,
    )
    expect(renderedBullets).toEqual(expect.arrayContaining(project.highlights))
  })
})
