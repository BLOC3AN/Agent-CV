import { CvFrame } from '../render.js'
import type { TemplateProps } from '../types.js'

/**
 * Mẫu "Thanh lịch" — tiêu đề có gạch chân màu nhấn, chip kỹ năng có nền.
 * Phù hợp gửi email / in ra. Bản ATS tự động bỏ hết trang trí (BR-32.1).
 */
export function Elegant(props: TemplateProps) {
  return <CvFrame {...props} templateId="elegant" />
}

export const elegantDefaults = {
  accent: '#1f4e79',
  headingCase: 'upper' as const,
  showDividers: true,
  showIcons: true,
}
