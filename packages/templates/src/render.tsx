import type { CSSProperties, ReactNode } from 'react'
import { Header, renderSection } from './sections.js'
import { resolve, type TemplateProps, type SectionId, type Theme } from './types.js'

/**
 * Khung render dùng chung — mọi template gọi hàm này.
 * Template chỉ khác nhau ở `classNamePrefix` và vài tinh chỉnh style.
 */

function cssVars(theme: Theme): CSSProperties {
  return {
    '--cv-accent': theme.accent,
    '--cv-text': theme.text,
    '--cv-muted': theme.muted,
    '--cv-font': theme.fontFamily,
    '--cv-scale': String(theme.scale),
    '--cv-line': String(theme.lineHeight),
    '--cv-margin': `${theme.pageMargin}mm`,
  } as CSSProperties
}

export function CvFrame(props: TemplateProps & { templateId: string }) {
  const { theme, layout, variant, isAts } = resolve(props)
  const visible = layout.order.filter((s) => !layout.hidden.includes(s))

  const body = (ids: SectionId[]): ReactNode[] =>
    ids
      .map((id) => renderSection(id, { profile: props.profile, variant }))
      .filter(Boolean) as ReactNode[]

  let content: ReactNode
  if (layout.columns === 2 && layout.sidebar && layout.sidebar.length > 0 && !isAts) {
    const side = new Set(layout.sidebar)
    content = (
      <div className="cv-two-col">
        <div>{body(visible.filter((s) => !side.has(s)))}</div>
        <aside>{body(visible.filter((s) => side.has(s)))}</aside>
      </div>
    )
  } else {
    // Bản ATS luôn rơi vào nhánh này — 1 cột, thứ tự DOM = thứ tự đọc
    content = <>{body(visible)}</>
  }

  return (
    <div
      className="cv-root"
      data-template={props.templateId}
      data-variant={variant}
      data-heading-case={theme.headingCase}
      data-dividers={String(theme.showDividers)}
      data-lang={props.profile.language}
      style={cssVars(theme)}
    >
      <div className="cv-page">
        <Header profile={props.profile} />
        {content}
      </div>
    </div>
  )
}
