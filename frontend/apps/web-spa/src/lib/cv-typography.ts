import type { CSSProperties } from 'react'
import type { CVDesign } from '../types'
import { A4_HEIGHT_MM, MM_TO_PX, lineHeightForSpacing } from './a4-settings'

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
  paddingTop: number
  paddingBottom: number
  paddingLeft: number
  paddingRight: number
  pageMargin: number
  textAlign: 'left' | 'right' | 'justify'
}

type CVTypographyDesign = Pick<CVDesign, 'font' | 'fontSize' | 'bodyFontSize' | 'sectionTitleFontSize' | 'headerFontSize' | 'paddingTop' | 'paddingBottom' | 'paddingLeft' | 'paddingRight' | 'pageMargin' | 'lineHeight' | 'textAlign'> & {
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
    lineHeight: String(design.lineHeight ?? lineHeightForSpacing(design.spacing)),
    paddingTop: design.paddingTop ?? 20,
    paddingBottom: design.paddingBottom ?? 20,
    paddingLeft: design.paddingLeft ?? 20,
    paddingRight: design.paddingRight ?? 20,
    pageMargin: design.pageMargin ?? 20,
    textAlign: design.textAlign ?? 'left',
  }
}

/**
 * Chiều cao vùng nội dung của MỘT tờ A4, tính bằng px.
 *
 * Đây là sức chứa mà preview dùng để cắt trang, và nó phải trùng đúng hộp nội
 * dung mà `printCSSForDesign` khai qua `@page{margin:…}` — cùng lấy từ bốn
 * padding, KHÔNG cộng `pageMargin` (khe giữa hai tờ giấy trên màn hình thôi).
 * Hai nửa lệch nhau là preview cắt trang một kiểu, PDF một kiểu.
 */
export function pageContentHeightPx(design: Parameters<typeof resolveCVTypography>[0]): number {
  const typography = resolveCVTypography(design)
  return (A4_HEIGHT_MM - typography.paddingTop - typography.paddingBottom) * MM_TO_PX
}

export function cvTypographyStyle(design: Parameters<typeof resolveCVTypography>[0]) {
  const typography = resolveCVTypography(design)
  return {
    '--cv-font-family': typography.fontFamily,
    '--cv-body-size': `${typography.bodyFontSize}pt`,
    '--cv-section-title-size': `${typography.sectionTitleFontSize}pt`,
    '--cv-header-size': `${typography.headerFontSize}pt`,
    '--cv-line-height': typography.lineHeight,
    '--cv-padding-top': `${typography.paddingTop}mm`,
    '--cv-padding-bottom': `${typography.paddingBottom}mm`,
    '--cv-padding-left': `${typography.paddingLeft}mm`,
    '--cv-padding-right': `${typography.paddingRight}mm`,
    '--cv-page-margin': `${typography.pageMargin}mm`,
    '--cv-text-align': typography.textAlign,
    fontFamily: typography.fontFamily,
    fontSize: `${typography.bodyFontSize}pt`,
    lineHeight: typography.lineHeight,
    textAlign: typography.textAlign,
  } as CSSProperties
}
