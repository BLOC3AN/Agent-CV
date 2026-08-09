import { describe, it, expect } from 'vitest'
import { CVSchema, PII_PATHS_V2 } from '../src/cv.js'

const minimal = {
  schemaVersion: 2,
  id: 'cv-1',
  title: 'CV Backend',
  lastModified: '2026-08-09T10:00:00Z',
  language: 'vi',
  sections: {
    intro: { fullName: 'Ada', title: 'Kỹ sư', email: '', phone: '', location: '', summary: '' },
    experience: [], projects: [], education: [],
    skills: [], activities: [], certifications: [], languages: [],
  },
  design: { template: 'modern', accentColor: '#4F46E5', font: 'Roboto', fontSize: 14, spacing: 'normal' },
  activeSections: {
    intro: true, experience: true, projects: true, education: true,
    skills: true, activities: true, certifications: true, languages: true,
  },
  _meta: { verified: {}, source: 'manual' },
}

describe('CV v2', () => {
  it('nhận hồ sơ tối thiểu hợp lệ', () => {
    expect(CVSchema.parse(minimal).schemaVersion).toBe(2)
  })

  it('kinh nghiệm dùng highlights[] chứ không phải description', () => {
    const cv = CVSchema.parse({
      ...minimal,
      sections: {
        ...minimal.sections,
        experience: [{
          id: 'e1', title: 'Engineer', company: 'FPT',
          startDate: '2023-01', endDate: '', current: true,
          highlights: ['Giảm 40% độ trễ', 'Dựng pipeline CI'],
        }],
      },
    })
    expect(cv.sections.experience[0]!.highlights).toHaveLength(2)
  })

  it('từ chối description ở kinh nghiệm — chat sinh patch nhắm vào từng bullet', () => {
    expect(() => CVSchema.parse({
      ...minimal,
      sections: {
        ...minimal.sections,
        experience: [{
          id: 'e1', title: 'Engineer', company: 'FPT',
          startDate: '2023-01', endDate: '', current: true,
          description: 'Làm nhiều thứ',
        }],
      },
    })).toThrow()
  })

  it('khai đúng năm đường dẫn PII của v2', () => {
    expect([...PII_PATHS_V2]).toEqual([
      '/sections/intro/fullName',
      '/sections/intro/email',
      '/sections/intro/phone',
      '/sections/intro/location',
      '/sections/intro/avatarUrl',
    ])
  })
})
