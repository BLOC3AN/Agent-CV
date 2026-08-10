import React from 'react'
import type { CV, CVLayout, CVNodeType, LayoutNode } from '../types'

export type CVRenderVariant = 'editor' | 'preview' | 'print'

export interface CVBlockRendererProps {
  cv: CV
  layout: CVLayout
  variant: CVRenderVariant
  onSelect?: (nodeId: string, itemId?: string) => void
  onEdit?: (nodeId: string, itemId?: string) => void
}

interface RenderContext extends CVBlockRendererProps {
  node: LayoutNode
}

const nodeLabels: Record<CVNodeType, string> = {
  header: 'Thông tin cá nhân',
  summary: 'Giới thiệu bản thân',
  experience: 'Kinh nghiệm làm việc',
  projects: 'Dự án nổi bật',
  education: 'Học vấn & Bằng cấp',
  skills: 'Kĩ năng & Công nghệ',
  certifications: 'Chứng chỉ',
  languages: 'Ngoại ngữ',
  footer: 'Footer',
}

const sectionTitles: Partial<Record<CVNodeType, string>> = {
  experience: 'KINH NGHIỆM LÀM VIỆC',
  projects: 'DỰ ÁN NỔI BẬT',
  education: 'HỌC VẤN & BẰNG CẤP',
  skills: 'KĨ NĂNG & CÔNG NGHỆ',
  certifications: 'CHỨNG CHỈ',
  languages: 'NGOẠI NGỮ',
}

function orderedItems<T extends { id: string }>(items: T[], itemOrder?: string[]): T[] {
  if (!itemOrder?.length) return items
  const byId = new Map(items.map((item) => [item.id, item]))
  const ordered = itemOrder.flatMap((id) => {
    const item = byId.get(id)
    return item ? [item] : []
  })
  const orderedIds = new Set(ordered.map((item) => item.id))
  return [...ordered, ...items.filter((item) => !orderedIds.has(item.id))]
}

function isActive(cv: CV, type: CVNodeType): boolean {
  if (type === 'header' || type === 'summary') return cv.activeSections.intro
  if (type === 'footer') return true
  return cv.activeSections[type]
}

function sectionHeading(context: RenderContext, title: string) {
  const { cv, variant } = context
  return (
    <h3
      className={variant === 'print' ? 'cv-section-title' : 'font-bold text-xs uppercase tracking-wider mb-2 border-b border-slate-200 pb-1'}
      style={{ color: cv.design.accentColor }}
    >
      {title}
    </h3>
  )
}

function interactiveProps(context: RenderContext, itemId?: string): React.HTMLAttributes<HTMLElement> {
  const { node, onEdit, onSelect } = context
  return {
    onClick: onSelect ? () => onSelect(node.id, itemId) : undefined,
    onDoubleClick: onEdit ? () => onEdit(node.id, itemId) : undefined,
  }
}

function nodeFrame(context: RenderContext, children: React.ReactNode, element: 'div' | 'header' | 'footer' = 'div') {
  const Element = element
  return (
    <Element
      data-cv-node={context.node.type}
      data-cv-node-id={context.node.id}
      data-testid={`cv-block-${context.node.type}`}
      aria-label={nodeLabels[context.node.type]}
      className={context.node.type === 'header'
        ? context.variant === 'print' ? 'cv-header' : 'mb-6 pb-4 border-b border-slate-200 relative'
        : undefined}
      {...interactiveProps(context)}
    >
      {children}
    </Element>
  )
}

function renderHeader(context: RenderContext) {
  const { cv, variant } = context
  const { intro } = cv.sections
  if (!isActive(cv, 'header')) return null
  if (variant === 'print') {
    return nodeFrame(context, <>
      <h1 className="cv-name">{intro.fullName}</h1>
      <p className="cv-headline">{intro.title}</p>
      <div className="cv-contact">{[intro.email, intro.phone, intro.location, intro.website].filter(Boolean).map((value) => <span key={value}>{value}</span>)}</div>
    </>, 'header')
  }
  return nodeFrame(context, <>
    <div className="absolute top-0 bottom-0 left-[-20mm] w-2.5" style={{ backgroundColor: cv.design.accentColor }} />
    <h1 className="text-2xl md:text-3xl font-extrabold uppercase tracking-tight text-slate-900">{intro.fullName || 'LE THANH HAI'}</h1>
    <p className="text-base font-bold mt-0.5" style={{ color: cv.design.accentColor }}>{intro.title || 'AI Engineer'}</p>
    <div className="flex flex-wrap items-center gap-x-3 text-xs text-slate-600 mt-2 font-medium">
      <span>{intro.email}</span>
      {intro.phone && <><span>•</span><span>{intro.phone}</span></>}
      {intro.location && <><span>•</span><span>{intro.location}</span></>}
    </div>
  </>, 'header')
}

function renderSummary(context: RenderContext) {
  const { cv, variant } = context
  if (!isActive(cv, 'summary') || !cv.sections.intro.summary) return null
  if (variant === 'print') return nodeFrame(context, <section className="cv-section"><p>{cv.sections.intro.summary}</p></section>)
  return nodeFrame(context, <div className="mb-6 text-xs text-slate-700 leading-relaxed"><h3 className="font-bold text-xs uppercase tracking-wider mb-1" style={{ color: cv.design.accentColor }}>GIỚI THIỆU BẢN THÂN</h3><p>{cv.sections.intro.summary}</p></div>)
}

function renderExperience(context: RenderContext) {
  const { cv, node, variant } = context
  const items = orderedItems(cv.sections.experience, 'itemOrder' in node ? node.itemOrder : undefined)
  if (!isActive(cv, 'experience') || !items.length) return null
  if (variant === 'print') return nodeFrame(context, <section className="cv-section">{sectionHeading(context, 'KINH NGHIỆM')}<div>{items.map((item) => <div className="cv-entry" key={item.id} {...interactiveProps(context, item.id)}><div className="cv-entry-head"><strong className="cv-entry-title">{item.title}</strong><span className="cv-entry-org">{item.company}</span><span className="cv-entry-date">{[item.startDate, item.endDate].filter(Boolean).join(' – ')}</span></div><ul className="cv-bullets">{item.highlights.map((text, index) => <li key={`${item.id}-${index}`}>{text}</li>)}</ul></div>)}</div></section>)
  return nodeFrame(context, <div className="mb-6">{sectionHeading(context, sectionTitles.experience!)}<div className="space-y-4">{items.map((item) => <div key={item.id} className="space-y-1" {...interactiveProps(context, item.id)}><div className="flex justify-between items-baseline"><span className="font-bold text-sm text-slate-900">{item.title} — <span className="font-semibold text-slate-700">{item.company}</span></span><span className="text-[11px] font-medium text-slate-500">{item.startDate} – {item.endDate}</span></div><p className="text-xs text-slate-700 whitespace-pre-line leading-relaxed">{item.highlights.join('\n')}</p></div>)}</div></div>)
}

function renderProjects(context: RenderContext) {
  const { cv, node, variant } = context
  const items = orderedItems(cv.sections.projects, 'itemOrder' in node ? node.itemOrder : undefined)
  if (!isActive(cv, 'projects') || !items.length) return null
  if (variant === 'print') return nodeFrame(context, <section className="cv-section">{sectionHeading(context, 'DỰ ÁN')}<div>{items.map((item) => <div className="cv-entry" key={item.id} {...interactiveProps(context, item.id)}><strong className="cv-entry-title">{item.name}</strong><ul className="cv-bullets">{item.highlights.map((text, index) => <li key={`${item.id}-${index}`}>{text}</li>)}</ul></div>)}</div></section>)
  return nodeFrame(context, <div className="mb-6">{sectionHeading(context, sectionTitles.projects!)}<div className="space-y-3">{items.map((item) => <div key={item.id} className="space-y-0.5" {...interactiveProps(context, item.id)}><div className="flex justify-between items-baseline"><span className="font-bold text-xs text-slate-900">{item.name} ({item.role})</span><span className="text-[11px] text-slate-500 font-medium">{item.startDate} - {item.endDate}</span></div><p className="text-xs text-slate-700 whitespace-pre-line">{item.highlights.join('\n')}</p></div>)}</div></div>)
}

function renderEducation(context: RenderContext) {
  const { cv, node, variant } = context
  const items = orderedItems(cv.sections.education, 'itemOrder' in node ? node.itemOrder : undefined)
  if (!isActive(cv, 'education') || !items.length) return null
  if (variant === 'print') return nodeFrame(context, <section className="cv-section">{sectionHeading(context, 'HỌC VẤN')}<div>{items.map((item) => <div className="cv-entry" key={item.id} {...interactiveProps(context, item.id)}><strong className="cv-entry-title">{item.school}</strong><span className="cv-entry-org">{item.degree} {item.fieldOfStudy}</span></div>)}</div></section>)
  return nodeFrame(context, <div className="mb-6">{sectionHeading(context, sectionTitles.education!)}<div className="space-y-2">{items.map((item) => <div key={item.id} className="flex justify-between items-baseline text-xs" {...interactiveProps(context, item.id)}><div><span className="font-bold text-slate-900">{item.school}</span><p className="text-slate-700">{item.degree} - {item.fieldOfStudy} {item.gpa ? `(GPA: ${item.gpa})` : ''}</p></div><span className="text-slate-500 font-medium">{item.startDate} - {item.endDate}</span></div>)}</div></div>)
}

function renderSkills(context: RenderContext) {
  const { cv, variant } = context
  if (!isActive(cv, 'skills') || !cv.sections.skills.length) return null
  if (variant === 'print') return nodeFrame(context, <section className="cv-section">{sectionHeading(context, 'KỸ NĂNG')}<div className="cv-skills">{cv.sections.skills.flatMap((group) => group.skills).map((skill) => <span className="cv-skill" key={skill}>{skill}</span>)}</div></section>)
  return nodeFrame(context, <div className="mb-6">{sectionHeading(context, sectionTitles.skills!)}<div className="space-y-1.5 text-xs text-slate-800">{cv.sections.skills.map((group) => <div key={group.id} className="flex"><span className="font-bold w-40 shrink-0 text-slate-900">{group.category}:</span><span className="text-slate-700">{group.skills.join(', ')}</span></div>)}</div></div>)
}

function renderCertifications(context: RenderContext) {
  const { cv, variant } = context
  if (!isActive(cv, 'certifications') || !cv.sections.certifications.length) return null
  if (variant === 'print') return nodeFrame(context, <section className="cv-section">{sectionHeading(context, 'CHỨNG CHỈ')}<div>{cv.sections.certifications.map((item) => <div className="cv-entry" key={item.id} {...interactiveProps(context, item.id)}><strong className="cv-entry-title">{item.name}</strong><span className="cv-entry-org">{item.issuer}</span></div>)}</div></section>)
  return nodeFrame(context, <div className="mb-6">{sectionHeading(context, sectionTitles.certifications!)}<ul className="list-disc list-inside text-xs text-slate-700 space-y-1">{cv.sections.certifications.map((item) => <li key={item.id} {...interactiveProps(context, item.id)}><span className="font-bold text-slate-900">{item.name}</span> ({item.issuer})</li>)}</ul></div>)
}

function renderLanguages(context: RenderContext) {
  const { cv, variant } = context
  if (!isActive(cv, 'languages') || !cv.sections.languages.length) return null
  if (variant === 'print') return nodeFrame(context, <section className="cv-section">{sectionHeading(context, 'NGOẠI NGỮ')}<div className="cv-skills">{cv.sections.languages.map((item) => <span className="cv-skill" key={item.id} {...interactiveProps(context, item.id)}>{item.language} — {item.proficiency}</span>)}</div></section>)
  return nodeFrame(context, <div className="mb-6">{sectionHeading(context, sectionTitles.languages!)}<ul className="text-xs text-slate-700 space-y-1">{cv.sections.languages.map((item) => <li key={item.id} className="flex justify-between" {...interactiveProps(context, item.id)}><span className="font-bold text-slate-900">{item.language}:</span><span className="text-slate-600">{item.proficiency}</span></li>)}</ul></div>)
}

function renderFooter(context: RenderContext) {
  // Footer has no persisted content fields yet. Keep a semantic anchor in the
  // ordered flow without introducing invented copy or changing the template.
  return nodeFrame(context, null, 'footer')
}

const nodeRenderers: Record<CVNodeType, (context: RenderContext) => React.ReactNode> = {
  header: renderHeader,
  summary: renderSummary,
  experience: renderExperience,
  projects: renderProjects,
  education: renderEducation,
  skills: renderSkills,
  certifications: renderCertifications,
  languages: renderLanguages,
  footer: renderFooter,
}

/** The one ordered-flow resolver used by the editor, preview, and SSR print view. */
export function CVBlockRenderer({ cv, layout, variant, onSelect, onEdit }: CVBlockRendererProps) {
  return <>{layout.nodes.filter((node) => node.visible).map((node) => <React.Fragment key={node.id}>{nodeRenderers[node.type]({ cv, layout, variant, onSelect, onEdit, node })}</React.Fragment>)}</>
}
