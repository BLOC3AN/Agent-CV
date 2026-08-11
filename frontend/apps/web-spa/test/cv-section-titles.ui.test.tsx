import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { CVBlockRenderer, type CVRenderVariant } from '../src/components/CVBlockRenderer'
import { sectionTitle, nodeLabel } from '../src/lib/cv-section-titles'
import { normalizeLayout } from '../src/lib/layout-draft'
import type { CV } from '../src/types'

const base = {
  schemaVersion: 2, id: 'cv-1', title: 'CV', lastModified: '',
  sections: {
    intro: { fullName: 'Alex Tran', title: 'Engineer', email: '', phone: '', location: '', summary: 'Summary text' },
    experience: [{ id: 'e1', title: 'Lead', company: 'Acme', startDate: '2024', endDate: '2025', highlights: ['Shipped'] }],
    projects: [{ id: 'p1', name: 'Platform', role: 'Lead', startDate: '2024', endDate: '2025', highlights: ['Built'] }],
    education: [{ id: 'd1', school: 'University', degree: 'BSc', fieldOfStudy: 'CS', startDate: '2020', endDate: '2024' }],
    skills: [{ id: 's1', category: 'Backend', skills: ['Go'] }],
    activities: [{ id: 'a1', organization: 'Guild', role: 'Mentor', startDate: '2024', endDate: '2025', highlights: ['Coached'] }],
    certifications: [{ id: 'c1', name: 'Cloud Pro', issuer: 'Cloud Org', date: '2025' }],
    languages: [{ id: 'l1', language: 'English', proficiency: 'C1' }],
  },
  design: { template: 'modern', accentColor: '#000', font: 'Roboto', fontSize: 14, spacing: 'normal' },
  activeSections: { intro: true, experience: true, projects: true, education: true, skills: true, activities: true, certifications: true, languages: true },
  _meta: { verified: {}, source: 'manual', canonical: {} },
} as unknown as CV

const cvIn = (language: 'vi' | 'en' | undefined) => ({ ...base, language } as CV)
const VARIANTS: CVRenderVariant[] = ['editor', 'preview', 'print']

function headingsFor(cv: CV, variant: CVRenderVariant): string[] {
  const { container } = render(<CVBlockRenderer cv={cv} layout={normalizeLayout(undefined)} variant={variant} />)
  return [...container.querySelectorAll('[data-cv-typography="section-title"]')].map((node) => node.textContent ?? '')
}

describe('bảng tiêu đề mục', () => {
  it('trả tiêu đề tiếng Anh khi CV là tiếng Anh', () => {
    expect(sectionTitle('experience', 'en')).toBe('WORK EXPERIENCE')
    expect(sectionTitle('education', 'en')).toBe('EDUCATION')
    expect(sectionTitle('languages', 'en')).toBe('LANGUAGES')
  })

  it('trả tiêu đề tiếng Việt khi CV là tiếng Việt', () => {
    expect(sectionTitle('experience', 'vi')).toBe('KINH NGHIỆM LÀM VIỆC')
    expect(sectionTitle('education', 'vi')).toBe('HỌC VẤN & BẰNG CẤP')
  })

  /** CV cũ trong cơ sở dữ liệu không có trường `language`. */
  it('lùi về tiếng Việt khi CV không khai ngôn ngữ', () => {
    expect(sectionTitle('experience', undefined)).toBe('KINH NGHIỆM LÀM VIỆC')
    expect(nodeLabel('header', undefined)).toBe('Thông tin cá nhân')
  })

  it('nhãn cây mục lục đổi theo ngôn ngữ', () => {
    expect(nodeLabel('experience', 'en')).toBe('Work experience')
    expect(nodeLabel('experience', 'vi')).toBe('Kinh nghiệm làm việc')
  })
})

describe('ba variant dùng chung một tiêu đề', () => {
  /*
   * Bản in từng dùng tiêu đề ngắn hơn bản trên màn hình ('KINH NGHIỆM' so với
   * 'KINH NGHIỆM LÀM VIỆC'), nên file PDF không khớp thứ người dùng nhìn thấy.
   * Test này khoá lại: trình sửa, xem trước và bản in phải cho cùng danh sách.
   */
  it('cùng một CV tiếng Việt cho cùng danh sách tiêu đề ở mọi variant', () => {
    const cv = cvIn('vi')
    const [editor, preview, print] = VARIANTS.map((variant) => headingsFor(cv, variant))

    expect(preview).toEqual(editor)
    expect(print).toEqual(editor)
  })

  it('cùng một CV tiếng Anh cho cùng danh sách tiêu đề ở mọi variant', () => {
    const cv = cvIn('en')
    const [editor, preview, print] = VARIANTS.map((variant) => headingsFor(cv, variant))

    expect(editor).toContain('WORK EXPERIENCE')
    expect(preview).toEqual(editor)
    expect(print).toEqual(editor)
  })

  it('không còn tiêu đề tiếng Việt nào khi CV là tiếng Anh', () => {
    for (const variant of VARIANTS) {
      const headings = headingsFor(cvIn('en'), variant).join(' ')
      expect(headings).not.toMatch(/[ăâđêôơưàáảãạèéẻẽẹìíỉĩịòóỏõọùúủũụỳýỷỹỵ]/i)
    }
  })
})
