import { describe, expect, it } from 'vitest'
import { applyChatOpsToDraft } from '../src/lib/cv-patch'
import type { CV, CVLayout } from '../src/types'

const cv = {
  id: 'cv-1', title: 'CV', lastModified: '',
  sections: { intro: { fullName: 'A', title: '', email: '', phone: '', location: '', summary: '' }, experience: [], projects: [], education: [], skills: [], activities: [], certifications: [], languages: [] },
  design: { template: 'modern', accentColor: '#000', font: 'Roboto', fontSize: 14, spacing: 'normal' },
  activeSections: { intro: true, experience: true, projects: true, education: true, skills: true, activities: true, certifications: true, languages: true },
} as CV

const layout: CVLayout = { version: 1, nodes: [{ id: 'experience', type: 'experience', visible: true }, { id: 'summary', type: 'summary', visible: true }] }
const operation = (op: string, path: string, value?: unknown) => ({ op, path, ...(op === 'remove' ? {} : { value }), rationale: 'Đề xuất hợp lệ', grounding: { type: 'user_message', ref: 'Tin nhắn' } }) as never

describe('applyChatOpsToDraft', () => {
  it('applies valid CV and layout order operations without mutating the committed draft', () => {
    const result = applyChatOpsToDraft({ cv, layout }, [
      operation('replace', '/sections/intro/fullName', 'AI draft'),
      operation('add', '/layout/nodes/0/itemOrder', ['item-2', 'item-1']),
    ])

    expect(result.cv.sections.intro.fullName).toBe('AI draft')
    expect(result.layout.nodes[0]).toMatchObject({ itemOrder: ['item-2', 'item-1'] })
    expect(cv.sections.intro.fullName).toBe('A')
    expect(layout.nodes[0]).not.toHaveProperty('itemOrder')
  })

  it('rejects malformed and unknown JSON Patch operations before changing any draft data', () => {
    expect(() => applyChatOpsToDraft({ cv, layout }, [operation('move', '/sections/intro/fullName', 'AI draft')])).toThrow(/không được hỗ trợ/i)
    expect(() => applyChatOpsToDraft({ cv, layout }, [operation('replace', '/sections/intro/missing', 'AI draft')])).toThrow(/không tồn tại/i)
    expect(() => applyChatOpsToDraft({ cv, layout }, [operation('add', '/layout/nodes/0/unknown', true)])).toThrow(/bố cục.*không hợp lệ/i)
  })
})
