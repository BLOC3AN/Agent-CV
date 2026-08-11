export const A4_PAGE_SETTINGS = {
  width: '210mm',
  height: '297mm',
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
