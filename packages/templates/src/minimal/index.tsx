import { CvFrame } from '../render.js'
import type { TemplateProps } from '../types.js'

/**
 * Mẫu "Tối giản" — không gạch chân, không nền, chữ đen, khoảng trắng nhiều.
 * Gần với bản ATS nhất; hợp môi trường học thuật và công ty truyền thống.
 */
export function Minimal(props: TemplateProps) {
  return <CvFrame {...props} templateId="minimal" />
}

export const minimalDefaults = {
  accent: '#111827',
  headingCase: 'normal' as const,
  showDividers: false,
  showIcons: false,
}
