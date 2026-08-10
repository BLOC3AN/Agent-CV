import { describe, expect, it } from 'vitest'
import {
  CV_FIELD_CATALOG,
  CVFieldPlacementSchema,
  CVLayoutSchema,
  DEFAULT_CV_LAYOUT,
  CVSchema,
  validateCVFieldPlacement,
} from '../src/index.js'

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

    expect(layout.nodes[0] && 'itemOrder' in layout.nodes[0] ? layout.nodes[0].itemOrder : undefined).toEqual(['job-2', 'job-1'])
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

  it('rejects item order on nodes without nested items', () => {
    for (const type of ['header', 'summary', 'skills', 'certifications', 'languages', 'footer'] as const) {
      expect(() => CVLayoutSchema.parse({
        version: 1,
        nodes: [{ id: type, type, visible: true, itemOrder: ['item-1'] }],
      })).toThrow()
    }
  })

  it('rejects unknown registered field keys at runtime', () => {
    expect(() => CVFieldPlacementSchema.parse({ key: 'unknownField', nodeType: 'experience' })).toThrow()
    expect(() => validateCVFieldPlacement('unknownField', 'experience')).toThrow()
  })

  it('rejects a registered field in a disallowed node placement', () => {
    expect(() => CVFieldPlacementSchema.parse({ key: 'company', nodeType: 'education' })).toThrow()
    expect(() => validateCVFieldPlacement('company', 'education')).toThrow()
  })

  it('accepts a registered field in an allowed node placement', () => {
    expect(CV_FIELD_CATALOG.length).toBeGreaterThan(0)
    expect(validateCVFieldPlacement('company', 'experience')).toMatchObject({ key: 'company' })
  })
})
