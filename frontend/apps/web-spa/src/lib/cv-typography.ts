import type { CSSProperties } from 'react'
import type { CVDesign } from '../types'

export const CV_FONT_FAMILIES: Record<CVDesign['font'], string> = {
  Auto: 'Calibri, Arial, sans-serif',
  Calibri: 'Calibri, Arial, sans-serif',
  Arial: 'Arial, Helvetica, sans-serif',
  'Times New Roman': '"Times New Roman", Times, serif',
  Roboto: 'Roboto, Arial, sans-serif',
  'Open Sans': '"Open Sans", Arial, sans-serif',
  Lato: 'Lato, Arial, sans-serif',
}

export interface CVTypography {
  fontFamily: string
  bodyFontSize: number
  sectionTitleFontSize: number
  headerFontSize: number
}

export function resolveCVTypography(design: Pick<CVDesign, 'font' | 'fontSize' | 'bodyFontSize' | 'sectionTitleFontSize' | 'headerFontSize'>): CVTypography {
  return {
    fontFamily: CV_FONT_FAMILIES[design.font] ?? CV_FONT_FAMILIES.Auto,
    bodyFontSize: design.bodyFontSize ?? design.fontSize,
    sectionTitleFontSize: design.sectionTitleFontSize ?? 11,
    headerFontSize: design.headerFontSize ?? 20,
  }
}

export function cvTypographyStyle(design: Parameters<typeof resolveCVTypography>[0]) {
  const typography = resolveCVTypography(design)
  return {
    '--cv-font-family': typography.fontFamily,
    '--cv-body-size': `${typography.bodyFontSize}pt`,
    '--cv-section-title-size': `${typography.sectionTitleFontSize}pt`,
    '--cv-header-size': `${typography.headerFontSize}pt`,
    fontFamily: typography.fontFamily,
    fontSize: `${typography.bodyFontSize}pt`,
  } as CSSProperties
}
