import { describe, it, expect } from 'vitest'
import { CVDesignSchema, CVSchema, PII_PATHS_V2 } from '../src/cv.js'

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
  it('supports independent typography sizes and the Auto font', () => {
    const design = CVDesignSchema.parse({
      template: 'modern', accentColor: '#4F46E5', font: 'Auto', fontSize: 14, spacing: 'normal',
      bodyFontSize: 10.5, sectionTitleFontSize: 13, headerFontSize: 20,
    })
    expect(design.font).toBe('Auto')
    expect(design.bodyFontSize).toBe(10.5)
    expect(design.sectionTitleFontSize).toBe(13)
    expect(design.headerFontSize).toBe(20)
  })

  it('defaults page spacing and text alignment for legacy CV designs', () => {
    const design = CVDesignSchema.parse({ font: 'Auto' })
    expect(design.paddingTop).toBe(20)
    expect(design.paddingBottom).toBe(20)
    expect(design.paddingLeft).toBe(20)
    expect(design.paddingRight).toBe(20)
    expect(design.pageMargin).toBe(20)
    expect(design.lineHeight).toBe(1.3)
    expect(design.textAlign).toBe('left')
  })

  it('rejects typography sizes outside the supported ranges', () => {
    expect(() => CVDesignSchema.parse({ font: 'Arial', bodyFontSize: 8 })).toThrow()
    expect(() => CVDesignSchema.parse({ font: 'Arial', sectionTitleFontSize: 17 })).toThrow()
    expect(() => CVDesignSchema.parse({ font: 'Arial', headerFontSize: 29 })).toThrow()
  })

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

  it('rejects empty persisted item ids', () => {
    expect(() => CVSchema.parse({
      ...minimal,
      sections: { ...minimal.sections, experience: [{ id: '', title: 'Engineer', company: '' }] },
    })).toThrow()
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

  it('stores registered fields in typed canonical properties', () => {
    const cv = CVSchema.parse({
      ...minimal,
      sections: {
        ...minimal.sections,
        intro: { ...minimal.sections.intro, careerObjective: 'Build reliable systems', availability: 'Two weeks' },
        experience: [{
          id: 'e1', title: 'Engineer', company: 'FPT', startDate: '', endDate: '', current: false,
          teamSize: '6 engineers', techStack: ['Go', 'React'], highlights: ['Team size: this is a real user bullet'],
        }],
        projects: [{
          id: 'p1', name: 'Platform', role: 'Lead', startDate: '', endDate: '',
          teamSize: '4 engineers', techStack: ['TypeScript'], contribution: 'Led delivery', highlights: [],
        }],
      },
    })

    expect(cv.sections.intro.availability).toBe('Two weeks')
    expect(cv.sections.intro.title).toBe('Kỹ sư')
    expect(cv.sections.experience[0]?.teamSize).toBe('6 engineers')
    expect(cv.sections.experience[0]?.highlights).toEqual(['Team size: this is a real user bullet'])
    expect(cv.sections.projects[0]?.contribution).toBe('Led delivery')
  })

  it.each([
    ['top level', { customField: true }],
    ['intro', { sections: { ...minimal.sections, intro: { ...minimal.sections.intro, customField: true } } }],
    ['sections', { sections: { ...minimal.sections, customSection: [] } }],
    ['design', { design: { ...minimal.design, padding: 24 } }],
    ['active sections', { activeSections: { ...minimal.activeSections, customSection: true } }],
    ['metadata', { _meta: { ...minimal._meta, customField: true } }],
  ])('rejects unknown keys at the %s boundary', (_name, override) => {
    expect(() => CVSchema.parse({ ...minimal, ...override })).toThrow()
  })
})
