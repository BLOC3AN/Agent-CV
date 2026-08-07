import type { Profile } from '@hr/schema'

/**
 * Template render CV — FRONTEND.md §9.3.
 *
 * MỘT component duy nhất dùng ở 3 nơi:
 *   1. /builder     xem trước live      (variant="screen")
 *   2. /print       Playwright → PDF    (variant="presentation" | "ats")
 *   3. thumbnail    ảnh nhỏ ở danh sách (variant="thumbnail")
 *
 * Đây là cách rẻ nhất để bản xem trước khớp file PDF (TDD §3.3): không viết
 * hai renderer.
 */

export type TemplateVariant = 'screen' | 'presentation' | 'ats' | 'thumbnail'

export type TemplateId = 'elegant' | 'minimal'

/** Mã section — trùng khoá của Profile để layout tham chiếu trực tiếp */
export type SectionId =
  | 'summary'
  | 'education'
  | 'work'
  | 'projects'
  | 'skills'
  | 'activities'
  | 'certifications'
  | 'languages'

export const ALL_SECTIONS: SectionId[] = [
  'summary',
  'work',
  'projects',
  'education',
  'skills',
  'activities',
  'certifications',
  'languages',
]

/**
 * Theme token — mức A của editor (FRONTEND.md §12): màu, font, giãn dòng.
 * KHÔNG có toạ độ. Layout mô tả bằng CẤU TRÚC để AI vẫn sửa được (TDD A2).
 */
export interface Theme {
  accent: string
  text: string
  muted: string
  fontFamily: string
  /** 0.9 = gọn, 1.0 = thường, 1.15 = thoáng */
  scale: number
  lineHeight: number
  /** mm */
  pageMargin: number
  headingCase: 'upper' | 'normal'
  showIcons: boolean
  showDividers: boolean
}

export const DEFAULT_THEME: Theme = {
  accent: '#1f4e79',
  text: '#111827',
  muted: '#4b5563',
  // Font có dấu tiếng Việt đầy đủ. Fallback hệ thống để bản ATS luôn render được.
  fontFamily: "'Be Vietnam Pro', 'Inter', 'Segoe UI', Arial, sans-serif",
  scale: 1,
  lineHeight: 1.5,
  pageMargin: 14,
  headingCase: 'upper',
  showIcons: true,
  showDividers: true,
}

export interface Layout {
  /** 1 hoặc 2. Mức B (M6) mới bật 2 cột; bản ATS LUÔN ép về 1 */
  columns: 1 | 2
  /** Thứ tự hiển thị — kéo thả trong SectionOutline sinh ra JSON Patch `move` */
  order: SectionId[]
  /** Section bị tắt vẫn giữ dữ liệu, chỉ không render (BR-31.2) */
  hidden: SectionId[]
  /** Chỉ dùng khi columns = 2 */
  sidebar?: SectionId[]
}

export const DEFAULT_LAYOUT: Layout = {
  columns: 1,
  order: ALL_SECTIONS,
  hidden: [],
}

export interface TemplateProps {
  profile: Profile
  theme?: Partial<Theme>
  layout?: Partial<Layout>
  variant?: TemplateVariant
}

/**
 * Bản ATS-safe — BR-32.1.
 * KHÔNG phải template riêng: cùng component, chỉ ép các tham số về dạng máy
 * quét hồ sơ đọc được. Nhiều hệ ATS parse sai CV 2 cột hoặc bỏ qua icon/bảng.
 */
export function atsTheme(theme: Theme): Theme {
  return {
    ...theme,
    accent: '#000000',
    text: '#000000',
    muted: '#000000',
    fontFamily: "'Times New Roman', Times, serif",
    showIcons: false,
    showDividers: false,
    headingCase: 'upper',
  }
}

export function atsLayout(layout: Layout): Layout {
  return { ...layout, columns: 1, ...(layout.sidebar ? { sidebar: [] } : {}) }
}

export function resolve(props: TemplateProps): {
  theme: Theme
  layout: Layout
  variant: TemplateVariant
  isAts: boolean
} {
  const variant = props.variant ?? 'screen'
  const isAts = variant === 'ats'
  const theme = { ...DEFAULT_THEME, ...props.theme }
  const layout = { ...DEFAULT_LAYOUT, ...props.layout }
  return {
    theme: isAts ? atsTheme(theme) : theme,
    layout: isAts ? atsLayout(layout) : layout,
    variant,
    isAts,
  }
}
