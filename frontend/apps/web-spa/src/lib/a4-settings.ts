export const A4_HEIGHT_MM = 297
export const A4_WIDTH_MM = 210
/** CSS quy ước 1in = 96px = 25.4mm. */
export const MM_TO_PX = 96 / 25.4

export const A4_PAGE_SETTINGS = {
  width: `${A4_WIDTH_MM}mm`,
  height: `${A4_HEIGHT_MM}mm`,
  padding: '20mm',
  contentWidth: '170mm',
  contentHeight: '257mm',
} as const

export type CVSpacing = 'condensed' | 'normal' | 'wide'

export function lineHeightForSpacing(spacing: CVSpacing | string | undefined): string {
  if (spacing === 'condensed') return '1.15'
  if (spacing === 'wide') return '1.5'
  return '1.3'
}
