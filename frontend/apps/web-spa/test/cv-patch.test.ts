import { describe, expect, it } from 'vitest'
import { applyChatOpsToDraft } from '../src/lib/cv-patch'
import { DEFAULT_CV_LAYOUT } from '@hr/schema'
import type { CV, CVLayout } from '../src/types'

const cv = {
  schemaVersion: 2, id: 'cv-1', title: 'CV', lastModified: '', language: 'vi',
  sections: { intro: { fullName: 'A', title: '', email: '', phone: '', location: '', summary: '' }, experience: [], projects: [], education: [], skills: [], activities: [], certifications: [], languages: [] },
  design: { template: 'modern', accentColor: '#000', font: 'Roboto', fontSize: 14, spacing: 'normal' },
  activeSections: { intro: true, experience: true, projects: true, education: true, skills: true, activities: true, certifications: true, languages: true },
  _meta: { verified: {}, source: 'manual', canonical: {} },
} as CV

const layout = structuredClone(DEFAULT_CV_LAYOUT) as CVLayout
const operation = (op: string, path: string, value?: unknown) => ({ op, path, ...(op === 'remove' ? {} : { value }), rationale: 'Đề xuất hợp lệ', grounding: { type: 'user_message', ref: 'Tin nhắn' } }) as never

describe('applyChatOpsToDraft', () => {
  it('applies valid CV and layout order operations without mutating the committed draft', () => {
    const result = applyChatOpsToDraft({ cv, layout }, [
      operation('replace', '/sections/intro/fullName', 'AI draft'),
      operation('add', '/layout/nodes/2/itemOrder', []),
    ])

    expect(result.cv.sections.intro.fullName).toBe('AI draft')
    expect(result.layout.nodes[2]).toMatchObject({ itemOrder: [] })
    expect(cv.sections.intro.fullName).toBe('A')
    expect(layout.nodes[2]).not.toHaveProperty('itemOrder')
  })

  it('rejects malformed and unknown JSON Patch operations before changing any draft data', () => {
    expect(() => applyChatOpsToDraft({ cv, layout }, [operation('move', '/sections/intro/fullName', 'AI draft')])).toThrow(/không được hỗ trợ/i)
    expect(() => applyChatOpsToDraft({ cv, layout }, [operation('replace', '/sections/intro/missing', 'AI draft')])).toThrow(/không được phép/i)
    expect(() => applyChatOpsToDraft({ cv, layout }, [operation('add', '/layout/nodes/0/unknown', true)])).toThrow(/không được phép/i)
    expect(() => applyChatOpsToDraft({ cv, layout }, [operation('replace', '/sections/intro', false)])).toThrow(/không được phép/i)
    expect(() => applyChatOpsToDraft({ cv, layout }, [operation('add', '/sections/skills/-', { id: 'skills-1', category: 'Data', skills: [7] })])).toThrow(/^AI_PATCH_INVALID_CV:/)
  })

  it.each([
    ['/sections/intro/customField', 'hidden state'],
    ['/design/padding', 24],
    ['/design/unknown', 1.4],
    ['/activeSections/experience', false],
  ])('rejects AI writes outside the registered path allowlist: %s', (path, value) => {
    expect(() => applyChatOpsToDraft({ cv, layout }, [operation('add', path, value)])).toThrow(/không được phép/i)
  })

  it('rejects removing a registered layout node instead of treating removal as hide', () => {
    expect(() => applyChatOpsToDraft({ cv, layout }, [operation('remove', '/layout/nodes/2')])).toThrow(/không được phép/i)
  })
})
