import React from 'react'
import { CV_FIELD_CATALOG } from '@hr/schema'
import type { CV, CVLayout, CVNodeType, LayoutNode } from '../types'

export type CVRenderVariant = 'editor' | 'preview' | 'print'

export interface CVBlockRendererProps {
  cv: CV
  layout: CVLayout
  variant: CVRenderVariant
  onSelect?: (nodeId: string, itemId?: string) => void
  onEdit?: (nodeId: string, itemId?: string) => void
  nodeIds?: string[]
  itemIds?: Record<string, string[]>
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
  activities: 'Hoạt động & Ngoại khóa',
  certifications: 'Chứng chỉ',
  languages: 'Ngoại ngữ',
  footer: 'Footer',
}

const sectionTitles: Partial<Record<CVNodeType, string>> = {
  summary: 'GIỚI THIỆU BẢN THÂN',
  experience: 'KINH NGHIỆM LÀM VIỆC',
  projects: 'DỰ ÁN NỔI BẬT',
  education: 'HỌC VẤN & BẰNG CẤP',
  skills: 'KĨ NĂNG & CÔNG NGHỆ',
  activities: 'HOẠT ĐỘNG & NGOẠI KHÓA',
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

function RegisteredValue({ fieldKey, value, label }: { fieldKey: string; value?: string | string[]; label?: string }) {
  const definition = CV_FIELD_CATALOG.find((field) => field.key === fieldKey)
  if (!definition || value == null || (Array.isArray(value) ? !value.length : !value)) return null
  const prefix = label ? `${label}: ` : ''
  if (definition.printStyle === 'tags' && Array.isArray(value)) {
    return <span className="cv-field-tags" data-cv-field={fieldKey} data-print-style={definition.printStyle}>{prefix}{value.map((text) => <span className="cv-field-tag" key={text}>{text}</span>)}</span>
  }
  const text = Array.isArray(value) ? value.join(', ') : value
  return <span className={`cv-field-${definition.printStyle}`} data-cv-field={fieldKey} data-print-style={definition.printStyle}>{prefix}{text}</span>
}

function RegisteredHighlights({ fieldKey = 'highlights', itemId, values }: { fieldKey?: string; itemId: string; values: string[] }) {
  const definition = CV_FIELD_CATALOG.find((field) => field.key === fieldKey)
  if (!definition || !values.length) return null
  return <ul className="cv-bullets" data-cv-field={fieldKey} data-print-style={definition.printStyle}>{values.map((text, index) => <li key={`${itemId}-${index}`}>{text}</li>)}</ul>
}

function sectionHeading(context: RenderContext, title: string) {
  const { cv, variant } = context
  return (
    <h3
      className={variant === 'print' ? 'cv-section-title' : 'font-bold text-xs uppercase tracking-wider mb-2 border-b border-slate-200 pb-1'}
      style={{ color: cv.design.accentColor, fontSize: 'var(--cv-section-title-size)' }}
      data-cv-typography="section-title"
    >
      {title}
    </h3>
  )
}

function interactiveProps(context: RenderContext, itemId?: string): React.HTMLAttributes<HTMLElement> {
  const { node, onEdit, onSelect } = context
  const hasNestedEditTargets = node.type === 'experience' || node.type === 'projects' || node.type === 'education'
  return {
    ...(itemId ? { 'data-cv-item-id': itemId } : {}),
    ...(onEdit ? {
      tabIndex: 0,
      // Item surfaces are buttons; their containing block must remain a group
      // to avoid nesting interactive buttons inside another button.
      role: hasNestedEditTargets && !itemId ? 'group' : 'button',
      onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        if (itemId) event.stopPropagation()
        onEdit(node.id, itemId)
      },
    } : {}),
    onClick: onSelect ? (event) => {
      if (itemId) event.stopPropagation()
      onSelect(node.id, itemId)
    } : undefined,
    onDoubleClick: onEdit ? (event) => {
      if (itemId) event.stopPropagation()
      onEdit(node.id, itemId)
    } : undefined,
  }
}

function itemsForNode<T extends { id: string }>(context: RenderContext, items: T[]): T[] {
  const allowed = context.itemIds?.[context.node.id]
  return allowed ? items.filter((item) => allowed.includes(item.id)) : items
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
      style={{
        fontFamily: 'var(--cv-font-family)',
        fontSize: 'var(--cv-body-size)',
        lineHeight: 'inherit',
      }}
      {...interactiveProps(context)}
    >
      {children}
    </Element>
  )
}

function renderHeader(context: RenderContext) {
  const { cv, variant } = context
  const { intro } = cv.sections
  if (variant === 'print') {
    return nodeFrame(context, <>
      {intro.avatarUrl && <img className="cv-avatar" data-cv-field="avatarUrl" data-print-style="inline" src={intro.avatarUrl} alt="" />}
      <h1 className="cv-name" style={{ fontSize: 'var(--cv-header-size)' }} data-cv-field="fullName">{intro.fullName}</h1>
      <p className="cv-headline" data-cv-field="title">{intro.title}</p>
      <div className="cv-contact">{intro.email && <span data-cv-field="email">{intro.email}</span>}{intro.phone && <span data-cv-field="phone">{intro.phone}</span>}{intro.location && <RegisteredValue fieldKey="location" value={intro.location} />}{intro.website && <span data-cv-field="website">{intro.website}</span>}</div>
      <p><RegisteredValue fieldKey="availability" value={intro.availability} label="Availability" /></p>
      {!context.layout.nodes.some((node) => node.type === 'summary' && node.visible) && <p><RegisteredValue fieldKey="careerObjective" value={intro.careerObjective} /></p>}
    </>, 'header')
  }
  return nodeFrame(context, <>
    <div className="absolute top-0 bottom-0 left-[-20mm] w-2.5" style={{ backgroundColor: cv.design.accentColor }} />
    {intro.avatarUrl && <img className="cv-avatar mb-2" data-cv-field="avatarUrl" data-print-style="inline" src={intro.avatarUrl} alt="" />}
    <h1 className="text-2xl md:text-3xl font-extrabold uppercase tracking-tight text-slate-900" style={{ fontSize: 'var(--cv-header-size)' }} data-cv-field="fullName">{intro.fullName || 'LE THANH HAI'}</h1>
    <p className="text-base font-bold mt-0.5" style={{ color: cv.design.accentColor }} data-cv-field="title">{intro.title || 'AI Engineer'}</p>
    <div className="flex flex-wrap items-center gap-x-3 text-xs text-slate-600 mt-2 font-medium">
      <span data-cv-field="email">{intro.email}</span>
      {intro.phone && <><span>•</span><span data-cv-field="phone">{intro.phone}</span></>}
      {intro.location && <><span>•</span><RegisteredValue fieldKey="location" value={intro.location} /></>}
      {intro.website && <><span>•</span><span data-cv-field="website">{intro.website}</span></>}
    </div>
    {intro.availability && <p className="mt-1 text-xs text-slate-600"><RegisteredValue fieldKey="availability" value={intro.availability} label="Availability" /></p>}
    {!context.layout.nodes.some((node) => node.type === 'summary' && node.visible) && intro.careerObjective && <p className="mt-2 text-xs text-slate-700"><RegisteredValue fieldKey="careerObjective" value={intro.careerObjective} /></p>}
  </>, 'header')
}

function renderSummary(context: RenderContext) {
  const { cv, variant } = context
  const { intro } = cv.sections
  const fallbackAvailability = !context.layout.nodes.some((node) => node.type === 'header' && node.visible)
  const fallbackLocation = !context.layout.nodes.some((node) => node.type === 'header' && node.visible)
  if (!intro.summary && !intro.careerObjective && !(fallbackAvailability && intro.availability) && !(fallbackLocation && intro.location)) return null
  const fallbackContact = fallbackLocation && <>{intro.website && <p><span data-cv-field="website">{intro.website}</span></p>}{intro.avatarUrl && <img className="cv-avatar" data-cv-field="avatarUrl" data-print-style="inline" src={intro.avatarUrl} alt="" />}</>
  if (variant === 'print') return nodeFrame(context, <section className="cv-section">{sectionHeading(context, sectionTitles.summary!)}<p data-cv-field="summary">{intro.summary}</p>{intro.careerObjective && <p><RegisteredValue fieldKey="careerObjective" value={intro.careerObjective} /></p>}{fallbackAvailability && <p><RegisteredValue fieldKey="availability" value={intro.availability} label="Availability" /></p>}{fallbackLocation && <p><RegisteredValue fieldKey="location" value={intro.location} label="Location" /></p>}{fallbackContact}</section>)
  return nodeFrame(context, <div className="mb-6 text-slate-700">{sectionHeading(context, sectionTitles.summary!)}<p data-cv-field="summary">{intro.summary}</p>{intro.careerObjective && <p className="mt-1"><RegisteredValue fieldKey="careerObjective" value={intro.careerObjective} /></p>}{fallbackAvailability && <p className="mt-1"><RegisteredValue fieldKey="availability" value={intro.availability} label="Availability" /></p>}{fallbackLocation && <p className="mt-1"><RegisteredValue fieldKey="location" value={intro.location} label="Location" /></p>}{fallbackContact}</div>)
}

function renderExperience(context: RenderContext) {
  const { cv, node, variant } = context
  const items = itemsForNode(context, orderedItems(cv.sections.experience, 'itemOrder' in node ? node.itemOrder : undefined))
  if (!items.length) return null
  const entries = items.map((item) => <div className="cv-entry space-y-1" key={item.id} {...interactiveProps(context, item.id)}><div className="cv-entry-head"><strong className="cv-entry-title"><RegisteredValue fieldKey="role" value={item.title} /></strong><span className="cv-entry-org"><RegisteredValue fieldKey="company" value={item.company} /></span><span className="cv-entry-date"><RegisteredValue fieldKey="time" value={[item.startDate, item.current ? 'Present' : item.endDate].filter(Boolean).join(' – ')} /></span></div><div className="flex flex-wrap gap-x-3 text-xs"><RegisteredValue fieldKey="teamSize" value={item.teamSize} label="Team size" /><RegisteredValue fieldKey="techStack" value={item.techStack} label="Tech stack" /></div><RegisteredHighlights itemId={item.id} values={item.highlights} /></div>)
  if (variant === 'print') return nodeFrame(context, <section className="cv-section">{sectionHeading(context, 'KINH NGHIỆM')}<div>{entries}</div></section>)
  return nodeFrame(context, <div className="mb-6">{sectionHeading(context, sectionTitles.experience!)}<div className="space-y-4">{entries}</div></div>)
}

function renderProjects(context: RenderContext) {
  const { cv, node, variant } = context
  const items = itemsForNode(context, orderedItems(cv.sections.projects, 'itemOrder' in node ? node.itemOrder : undefined))
  if (!items.length) return null
  const entries = items.map((item) => <div className="cv-entry space-y-1" key={item.id} {...interactiveProps(context, item.id)}><div className="cv-entry-head"><strong className="cv-entry-title"><RegisteredValue fieldKey="name" value={item.name} /></strong><span className="cv-entry-org"><RegisteredValue fieldKey="role" value={item.role} /></span><span className="cv-entry-date"><RegisteredValue fieldKey="time" value={[item.startDate, item.endDate].filter(Boolean).join(' – ')} /></span></div>{item.link && <RegisteredValue fieldKey="link" value={item.link} />}<div className="flex flex-wrap gap-x-3 text-xs"><RegisteredValue fieldKey="teamSize" value={item.teamSize} label="Team size" /><RegisteredValue fieldKey="techStack" value={item.techStack} label="Tech stack" /></div>{item.contribution && <p><RegisteredValue fieldKey="contribution" value={item.contribution} label="Contribution" /></p>}<RegisteredHighlights itemId={item.id} values={item.highlights} /></div>)
  if (variant === 'print') return nodeFrame(context, <section className="cv-section">{sectionHeading(context, 'DỰ ÁN')}<div>{entries}</div></section>)
  return nodeFrame(context, <div className="mb-6">{sectionHeading(context, sectionTitles.projects!)}<div className="space-y-3">{entries}</div></div>)
}

function renderEducation(context: RenderContext) {
  const { cv, node, variant } = context
  const items = itemsForNode(context, orderedItems(cv.sections.education, 'itemOrder' in node ? node.itemOrder : undefined))
  if (!items.length) return null
  const entries = items.map((item) => <div className="cv-entry" key={item.id} {...interactiveProps(context, item.id)}><div className="cv-entry-head"><strong className="cv-entry-title"><RegisteredValue fieldKey="school" value={item.school} /></strong><span className="cv-entry-org"><RegisteredValue fieldKey="degree" value={item.degree} />{item.fieldOfStudy && <> — <RegisteredValue fieldKey="field" value={item.fieldOfStudy} /></>}</span><span className="cv-entry-date"><RegisteredValue fieldKey="time" value={[item.startDate, item.endDate].filter(Boolean).join(' – ')} /></span></div>{item.gpa && <p><RegisteredValue fieldKey="gpa" value={item.gpa} label="GPA" /></p>}<RegisteredHighlights itemId={item.id} values={item.highlights ?? []} /></div>)
  if (variant === 'print') return nodeFrame(context, <section className="cv-section">{sectionHeading(context, 'HỌC VẤN')}<div>{entries}</div></section>)
  return nodeFrame(context, <div className="mb-6">{sectionHeading(context, sectionTitles.education!)}<div className="space-y-2">{entries}</div></div>)
}

function renderSkills(context: RenderContext) {
  const { cv, node, variant } = context
  if (!cv.sections.skills.length) return null
  const groups = orderedItems(cv.sections.skills, 'itemOrder' in node ? node.itemOrder : undefined)
  if (variant === 'print') return nodeFrame(context, <section className="cv-section">{sectionHeading(context, 'KỸ NĂNG')}<div>{groups.map((group) => <p key={group.id} {...interactiveProps(context, group.id)}><strong><RegisteredValue fieldKey="category" value={group.category} />: </strong><span className="cv-skills"><span data-cv-field="skills" data-print-style="tags">{group.skills.join(', ')}</span></span></p>)}</div></section>)
  return nodeFrame(context, <div className="mb-6">{sectionHeading(context, sectionTitles.skills!)}<div className="space-y-1.5 text-slate-800">{groups.map((group) => <div key={group.id} className="flex" {...interactiveProps(context, group.id)}><span className="font-bold w-40 shrink-0 text-slate-900"><RegisteredValue fieldKey="category" value={group.category} />:</span><span className="text-slate-700"><span data-cv-field="skills" data-print-style="tags">{group.skills.join(', ')}</span></span></div>)}</div></div>)
}

function renderActivities(context: RenderContext) {
  const { cv, node, variant } = context
  if (!cv.sections.activities.length) return null
  const entries = orderedItems(cv.sections.activities, 'itemOrder' in node ? node.itemOrder : undefined).map((item) => <div className="cv-entry" key={item.id} {...interactiveProps(context, item.id)}><div className="cv-entry-head"><strong className="cv-entry-title"><RegisteredValue fieldKey="organization" value={item.organization} /></strong><span className="cv-entry-org"><RegisteredValue fieldKey="role" value={item.role} /></span><span className="cv-entry-date"><RegisteredValue fieldKey="time" value={[item.startDate, item.endDate].filter(Boolean).join(' – ')} /></span></div><RegisteredHighlights itemId={item.id} values={item.highlights} /></div>)
  if (variant === 'print') return nodeFrame(context, <section className="cv-section">{sectionHeading(context, 'HOẠT ĐỘNG')}<div>{entries}</div></section>)
  return nodeFrame(context, <div className="mb-6">{sectionHeading(context, sectionTitles.activities!)}<div className="space-y-2">{entries}</div></div>)
}

function renderCertifications(context: RenderContext) {
  const { cv, node, variant } = context
  if (!cv.sections.certifications.length) return null
  const entries = orderedItems(cv.sections.certifications, 'itemOrder' in node ? node.itemOrder : undefined).map((item) => <div className="cv-entry" key={item.id} {...interactiveProps(context, item.id)}><strong className="cv-entry-title"><RegisteredValue fieldKey="name" value={item.name} /></strong><span className="cv-entry-org"><RegisteredValue fieldKey="issuer" value={item.issuer} /></span><span className="cv-entry-date"><RegisteredValue fieldKey="date" value={item.date} /></span>{item.link && <RegisteredValue fieldKey="link" value={item.link} />}</div>)
  if (variant === 'print') return nodeFrame(context, <section className="cv-section">{sectionHeading(context, 'CHỨNG CHỈ')}<div>{entries}</div></section>)
  return nodeFrame(context, <div className="mb-6">{sectionHeading(context, sectionTitles.certifications!)}<div className="space-y-1 text-slate-700">{entries}</div></div>)
}

function renderLanguages(context: RenderContext) {
  const { cv, node, variant } = context
  if (!cv.sections.languages.length) return null
  const languages = orderedItems(cv.sections.languages, 'itemOrder' in node ? node.itemOrder : undefined)
  if (variant === 'print') return nodeFrame(context, <section className="cv-section">{sectionHeading(context, 'NGOẠI NGỮ')}<div className="cv-skills">{languages.map((item) => <span className="cv-skill" key={item.id} {...interactiveProps(context, item.id)}><RegisteredValue fieldKey="language" value={item.language} /> — <RegisteredValue fieldKey="proficiency" value={item.proficiency} /></span>)}</div></section>)
  return nodeFrame(context, <div className="mb-6">{sectionHeading(context, sectionTitles.languages!)}<ul className="text-slate-700 space-y-1">{languages.map((item) => <li key={item.id} className="flex justify-between" {...interactiveProps(context, item.id)}><span className="font-bold text-slate-900"><RegisteredValue fieldKey="language" value={item.language} />:</span><span className="text-slate-600"><RegisteredValue fieldKey="proficiency" value={item.proficiency} /></span></li>)}</ul></div>)
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
  activities: renderActivities,
  certifications: renderCertifications,
  languages: renderLanguages,
  footer: renderFooter,
}

/** The one ordered-flow resolver used by the editor, preview, and SSR print view. */
export function CVBlockRenderer({ cv, layout, variant, onSelect, onEdit, nodeIds, itemIds }: CVBlockRendererProps) {
  const nodeIdSet = nodeIds ? new Set(nodeIds) : undefined
  return <>{layout.nodes.filter((node) => node.visible && (!nodeIdSet || nodeIdSet.has(node.id))).map((node) => <React.Fragment key={node.id}>{nodeRenderers[node.type]({ cv, layout, variant, onSelect, onEdit, node, itemIds })}</React.Fragment>)}</>
}
