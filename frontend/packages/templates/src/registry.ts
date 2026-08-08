import type { ComponentType } from 'react'
import { Elegant, elegantDefaults } from './elegant/index.js'
import { Minimal, minimalDefaults } from './minimal/index.js'
import type { TemplateId, TemplateProps, Theme } from './types.js'

export interface TemplateEntry {
  id: TemplateId
  name: { vi: string; en: string }
  component: ComponentType<TemplateProps>
  defaults: Partial<Theme>
}

/** MVP chỉ 2 mẫu (idea.md: "1-2 cái mẫu thôi") */
export const TEMPLATES: Record<TemplateId, TemplateEntry> = {
  elegant: {
    id: 'elegant',
    name: { vi: 'Thanh lịch', en: 'Elegant' },
    component: Elegant,
    defaults: elegantDefaults,
  },
  minimal: {
    id: 'minimal',
    name: { vi: 'Tối giản', en: 'Minimal' },
    component: Minimal,
    defaults: minimalDefaults,
  },
}

export function getTemplate(id: string): TemplateEntry {
  return TEMPLATES[id as TemplateId] ?? TEMPLATES.elegant
}

export const TEMPLATE_IDS = Object.keys(TEMPLATES) as TemplateId[]
