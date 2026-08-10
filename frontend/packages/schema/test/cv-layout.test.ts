import { describe, expect, it } from 'vitest'
import { CVLayoutSchema, DEFAULT_CV_LAYOUT, CVSchema } from '../src/index.js'

const legacyCV = {
  schemaVersion: 2,
  id: 'cv-1',
  title: 'CV Backend',
  lastModified: '2026-08-09T10:00:00Z',
  language: 'vi',
  sections: {
    intro: { fullName: 'Ada', title: 'Kỹ sư', email: '', phone: '', location: '', summary: '' },
    experience: [], projects: [], education: [], skills: [], activities: [], certifications: [], languages: [],
  },
}

describe('CV layout contract', () => {
  it('normalizes a legacy CV without layout to the stable default order', () => {
    expect(DEFAULT_CV_LAYOUT).toBeDefined()
    const cv = CVSchema.parse(legacyCV)

    expect(cv.layout).toEqual(DEFAULT_CV_LAYOUT)
  })

  it('accepts nested item order on supported nodes', () => {
    expect(CVLayoutSchema).toBeDefined()
    const layout = CVLayoutSchema.parse({
      version: 1,
      nodes: [{ id: 'experience', type: 'experience', visible: true, itemOrder: ['job-2', 'job-1'] }],
    })

    expect(layout.nodes[0]?.itemOrder).toEqual(['job-2', 'job-1'])
  })

  it('rejects unknown node types', () => {
    expect(CVLayoutSchema).toBeDefined()
    expect(() => CVLayoutSchema.parse({
      version: 1,
      nodes: [{ id: 'unknown', type: 'sidebar', visible: true }],
    })).toThrow()
  })

  it('rejects persisted pixel-position properties', () => {
    expect(CVLayoutSchema).toBeDefined()
    expect(() => CVLayoutSchema.parse({
      version: 1,
      nodes: [{ id: 'header', type: 'header', visible: true, x: 12, y: 24, width: 400 }],
    })).toThrow()
  })
})
