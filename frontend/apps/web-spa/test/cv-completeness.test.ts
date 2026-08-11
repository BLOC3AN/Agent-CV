import { describe, expect, it } from 'vitest'
import { cvCompleteness } from '../src/lib/cv-completeness'
import type { CV } from '../src/types'

/** CV rỗng hợp lệ — mỗi test tự bật đúng phần nó đo. */
function emptyCV(overrides: Partial<CV['sections']> = {}): CV {
  return {
    schemaVersion: 2, id: 'cv-1', title: 'CV', lastModified: '', language: 'vi',
    sections: {
      intro: { fullName: '', title: '', email: '', phone: '', location: '', summary: '' },
      experience: [], projects: [], education: [], skills: [], activities: [], certifications: [], languages: [],
      ...overrides,
    },
    design: { template: 'modern', accentColor: '#000', font: 'Roboto', fontSize: 14, spacing: 'normal' },
    activeSections: { intro: true, experience: true, projects: true, education: true, skills: true, activities: true, certifications: true, languages: true },
    _meta: { verified: {}, source: 'manual', canonical: {} },
  } as unknown as CV
}

const fullExperience = { id: 'e1', title: 'Lead', company: 'Acme', startDate: '2024', endDate: '2025', highlights: ['Shipped a platform'] }

describe('độ hoàn thiện CV', () => {
  it('CV rỗng được 0', () => {
    expect(cvCompleteness(emptyCV())).toBe(0)
  })

  it('CV đủ mọi tiêu chí được 100', () => {
    const cv = emptyCV({
      intro: { fullName: 'Alex', title: 'Engineer', email: 'a@example.com', phone: '0900', location: '', summary: 'Builds systems' },
      experience: [fullExperience],
      education: [{ id: 'd1', school: 'University', degree: 'BSc', fieldOfStudy: 'CS', startDate: '2020', endDate: '2024', highlights: [] }],
      skills: [{ id: 's1', category: 'Backend', skills: ['Go'] }],
    } as never)

    expect(cvCompleteness(cv)).toBe(100)
  })

  /* Liên hệ tính theo tỉ lệ ba trường, vì thiếu một trường khác hẳn thiếu cả ba. */
  it('liên hệ cho điểm theo số trường đã điền', () => {
    const oneOfThree = emptyCV({ intro: { fullName: 'Alex', title: '', email: '', phone: '', location: '', summary: '' } } as never)
    const twoOfThree = emptyCV({ intro: { fullName: 'Alex', title: '', email: 'a@example.com', phone: '', location: '', summary: '' } } as never)

    expect(cvCompleteness(oneOfThree)).toBe(7)
    expect(cvCompleteness(twoOfThree)).toBe(13)
  })

  /*
   * Ngày tháng là chỗ ATS đọc sai nhiều nhất, nên một mục kinh nghiệm thiếu
   * thời gian KHÔNG được tính là đủ — kể cả khi có chức danh và công ty.
   */
  it('kinh nghiệm thiếu thời gian không được tính đủ', () => {
    const withDates = emptyCV({ experience: [fullExperience] } as never)
    const noDates = emptyCV({ experience: [{ ...fullExperience, startDate: '', endDate: '' }] } as never)

    expect(cvCompleteness(withDates)).toBeGreaterThan(cvCompleteness(noDates))
  })

  it('mục đang làm không cần ngày kết thúc', () => {
    const current = emptyCV({ experience: [{ ...fullExperience, endDate: '', current: true }] } as never)

    expect(cvCompleteness(current)).toBe(cvCompleteness(emptyCV({ experience: [fullExperience] } as never)))
  })

  /* Khẳng định thứ tự chứ không phải một hiệu số cụ thể: 15 điểm chia cho hai
     mục ra 7,5 và làm tròn che mất, nhưng thứ tự thì luôn đúng. */
  it('càng nhiều mục có gạch đầu dòng thì điểm càng cao', () => {
    const none = emptyCV({ experience: [{ ...fullExperience, highlights: [] }, { ...fullExperience, id: 'e2', highlights: [] }] } as never)
    const half = emptyCV({ experience: [fullExperience, { ...fullExperience, id: 'e2', highlights: [] }] } as never)
    const all = emptyCV({ experience: [fullExperience, { ...fullExperience, id: 'e2' }] } as never)

    expect(cvCompleteness(none)).toBeLessThan(cvCompleteness(half))
    expect(cvCompleteness(half)).toBeLessThan(cvCompleteness(all))
  })

  it('nhóm kỹ năng rỗng không được tính', () => {
    const emptyGroup = emptyCV({ skills: [{ id: 's1', category: 'Backend', skills: [] }] } as never)

    expect(cvCompleteness(emptyGroup)).toBe(0)
  })

  it('học vấn thiếu tên trường không được tính', () => {
    const noSchool = emptyCV({ education: [{ id: 'd1', school: '', degree: 'BSc', fieldOfStudy: '', startDate: '', endDate: '', highlights: [] }] } as never)

    expect(cvCompleteness(noSchool)).toBe(0)
  })

  it('luôn nằm trong khoảng 0–100', () => {
    const cv = emptyCV({
      intro: { fullName: 'Alex', title: 'Engineer', email: 'a@example.com', phone: '0900', location: '', summary: 'x' },
      experience: Array.from({ length: 20 }, (_, i) => ({ ...fullExperience, id: `e${i}` })),
      education: [{ id: 'd1', school: 'University', degree: '', fieldOfStudy: '', startDate: '', endDate: '', highlights: [] }],
      skills: [{ id: 's1', category: 'Backend', skills: ['Go'] }],
    } as never)

    expect(cvCompleteness(cv)).toBe(100)
  })
})
