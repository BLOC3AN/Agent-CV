import type { CSSProperties } from 'react'
import type { CVDesign } from '../types'
import { lineHeightForSpacing } from './a4-settings'

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
  lineHeight: string
}

type CVTypographyDesign = Pick<CVDesign, 'font' | 'fontSize' | 'bodyFontSize' | 'sectionTitleFontSize' | 'headerFontSize'> & {
  spacing?: CVDesign['spacing']
}

export function resolveCVTypography(design: CVTypographyDesign): CVTypography {
  // CVs created before the typography controls used 14pt as the implicit body
  // default. Once the explicit body control exists, that legacy value should
  // render as the new 10.5pt default; an explicit bodyFontSize always wins.
  const bodyFontSize = design.bodyFontSize ?? (design.fontSize === 14 ? 10.5 : design.fontSize)
  return {
    fontFamily: CV_FONT_FAMILIES[design.font] ?? CV_FONT_FAMILIES.Auto,
    bodyFontSize,
    sectionTitleFontSize: design.sectionTitleFontSize ?? 13,
    headerFontSize: design.headerFontSize ?? 20,
    lineHeight: lineHeightForSpacing(design.spacing),
  }
}

export function cvTypographyStyle(design: Parameters<typeof resolveCVTypography>[0]) {
  const typography = resolveCVTypography(design)
  return {
    '--cv-font-family': typography.fontFamily,
    '--cv-body-size': `${typography.bodyFontSize}pt`,
    '--cv-section-title-size': `${typography.sectionTitleFontSize}pt`,
    '--cv-header-size': `${typography.headerFontSize}pt`,
    '--cv-line-height': typography.lineHeight,
    fontFamily: typography.fontFamily,
    fontSize: `${typography.bodyFontSize}pt`,
  } as CSSProperties
}
