import React from 'react'
import { CV_FIELD_CATALOG } from '@hr/schema'
import type { CVChangeKind, CVChangeMap } from '../lib/cv-diff'
import type { CV, CVLayout, CVNodeType, LayoutNode } from '../types'
import { nodeLabel, sectionTitle } from '../lib/cv-section-titles'

export type CVRenderVariant = 'editor' | 'preview' | 'print'

/**
 * Một item bị cắt ngang trang: `head` cho biết trang này có render phần đầu
 * (chức danh, tổ chức, ngày, tech stack…) hay không, `highlights` là các index
 * GỐC trong mảng `highlights` mà trang này nhận. Vắng mặt = render đầy đủ.
 */
export interface CVItemSlice {
  head: boolean
  highlights: number[]
}

export interface CVBlockRendererProps {
  cv: CV
  layout: CVLayout
  variant: CVRenderVariant
  onSelect?: (nodeId: string, itemId?: string) => void
  onEdit?: (nodeId: string, itemId?: string) => void
  nodeIds?: string[]
  itemIds?: Record<string, string[]>
  itemSlices?: Record<string, CVItemSlice>
  /** Highlights the block the left-hand tree currently points at. */
  selectedNodeId?: string
  selectedItemId?: string
  /** Version history diff: marks what moved relative to the compared snapshot. */
  changes?: CVChangeMap
  /**
   * Ngôn ngữ dùng để hiển thị tiêu đề mục.
   *
   * Vắng mặt thì lùi về `cv.language` — đó là đường của trang in SSR
   * (`server/print.tsx`), nơi không có tuỳ chọn người dùng nào để đọc. Trên
   * màn hình thì trình sửa và popup truyền ngôn ngữ giao diện xuống, vì tuỳ
   * chọn của người dùng luôn thắng.
   */
  language?: string
}

interface RenderContext extends CVBlockRendererProps {
  node: LayoutNode
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

function RegisteredValue({ fieldKey, value, label, change }: { fieldKey: string; value?: string | string[]; label?: string; change?: CVChangeKind }) {
  const definition = CV_FIELD_CATALOG.find((field) => field.key === fieldKey)
  if (!definition || value == null || (Array.isArray(value) ? !value.length : !value)) return null
  const prefix = label ? `${label}: ` : ''
  if (definition.printStyle === 'tags' && Array.isArray(value)) {
    return <span className="cv-field-tags" data-cv-field={fieldKey} data-print-style={definition.printStyle} data-cv-change={change}>{prefix}{value.map((text) => <span className="cv-field-tag" key={text}>{text}</span>)}</span>
  }
  const text = Array.isArray(value) ? value.join(', ') : value
  return <span className={`cv-field-${definition.printStyle}`} data-cv-field={fieldKey} data-print-style={definition.printStyle} data-cv-change={change}>{prefix}{text}</span>
}

function RegisteredHighlights({ fieldKey = 'highlights', itemId, values, changes, changePath, indexes }: { fieldKey?: string; itemId: string; values: string[]; changes?: CVChangeMap; changePath?: string; indexes?: number[] }) {
  const definition = CV_FIELD_CATALOG.find((field) => field.key === fieldKey)
  // `indexes` là index GỐC, không phải vị trí sau khi lọc: `data-cv-change` tra
  // theo `${changePath}.${index}` nên đánh số lại sẽ trỏ nhầm ô diff.
  const picked = (indexes ?? values.map((_, index) => index)).filter((index) => values[index] != null)
  if (!definition || !picked.length) return null
  return <ul className="cv-bullets" data-cv-field={fieldKey} data-print-style={definition.printStyle}>{picked.map((index) => <li key={`${itemId}-${index}`} data-cv-change={changePath ? changes?.[`${changePath}.${index}`] : undefined}>{values[index]}</li>)}</ul>
}

/**
 * Every dated section shares one head: "<title> - <organisation>" on the left
 * and the date range flushed to the right edge of the same line. Callers pass
 * `organisation`/`date` as null when the underlying value is empty so the
 * separator never dangles on its own.
 */
function EntryHead({ title, organisation, date }: { title: React.ReactNode; organisation?: React.ReactNode; date?: React.ReactNode }) {
  return (
    <div className="cv-entry-head">
      <span className="cv-entry-heading">
        <strong className="cv-entry-title">{title}</strong>
        {organisation != null && <><span className="cv-entry-sep" aria-hidden="true"> - </span><span className="cv-entry-org">{organisation}</span></>}
      </span>
      {date != null && <span className="cv-entry-date">{date}</span>}
    </div>
  )
}

function dateRange(start?: string, end?: string): string {
  return [start, end].filter(Boolean).join(' – ')
}

/**
 * Field-level diff lookup for one entry, e.g. `changeAt('experience', 'exp-1')('company')`.
 * List fields are diffed per element, so a field the renderer joins into a
 * single run of text reports as changed when any of its elements moved.
 */
function changeAt(context: RenderContext, section: string, itemId: string) {
  return (field?: string): CVChangeKind | undefined => {
    const { changes } = context
    if (!changes) return undefined
    const path = field ? `${section}.${itemId}.${field}` : `${section}.${itemId}`
    if (changes[path]) return changes[path]
    if (!field) return undefined
    return Object.keys(changes).some((candidate) => candidate.startsWith(`${path}.`)) ? 'changed' : undefined
  }
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
  const { changes, node, onEdit, onSelect, selectedItemId, selectedNodeId } = context
  const hasNestedEditTargets = node.type === 'experience' || node.type === 'projects' || node.type === 'education'
  const selected = selectedNodeId === node.id && (itemId ? selectedItemId === itemId : !selectedItemId)
  return {
    ...(itemId ? { 'data-cv-item-id': itemId } : {}),
    ...(selected ? { 'data-cv-selected': 'true' } : {}),
    ...(itemId && changes?.[`${node.type}.${itemId}`] ? { 'data-cv-change': changes[`${node.type}.${itemId}`] } : {}),
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
      aria-label={nodeLabel(context.node.type, context.language ?? context.cv.language)}
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
  const changed = (field: string) => context.changes?.[`intro.${field}`]
  if (variant === 'print') {
    return nodeFrame(context, <>
      {intro.avatarUrl && <img className="cv-avatar" data-cv-field="avatarUrl" data-print-style="inline" src={intro.avatarUrl} alt="" />}
      <h1 className="cv-name" style={{ fontSize: 'var(--cv-header-size)' }} data-cv-field="fullName" data-cv-change={changed('fullName')}>{intro.fullName}</h1>
      <p className="cv-headline" data-cv-field="title" data-cv-change={changed('title')}>{intro.title}</p>
      <div className="cv-contact">{intro.email && <span data-cv-field="email" data-cv-change={changed('email')}>{intro.email}</span>}{intro.phone && <span data-cv-field="phone" data-cv-change={changed('phone')}>{intro.phone}</span>}{intro.location && <RegisteredValue fieldKey="location" value={intro.location} change={changed('location')} />}{intro.website && <span data-cv-field="website" data-cv-change={changed('website')}>{intro.website}</span>}</div>
      <p><RegisteredValue fieldKey="availability" value={intro.availability} label="Availability" change={changed('availability')} /></p>
      {!context.layout.nodes.some((node) => node.type === 'summary' && node.visible) && <p><RegisteredValue fieldKey="careerObjective" value={intro.careerObjective} change={changed('careerObjective')} /></p>}
    </>, 'header')
  }
  return nodeFrame(context, <>
    <div className="absolute top-0 bottom-0 left-[-20mm] w-2.5" style={{ backgroundColor: cv.design.accentColor }} />
    {intro.avatarUrl && <img className="cv-avatar mb-2" data-cv-field="avatarUrl" data-print-style="inline" src={intro.avatarUrl} alt="" />}
    <h1 className="text-2xl md:text-3xl font-extrabold uppercase tracking-tight text-slate-900" style={{ fontSize: 'var(--cv-header-size)' }} data-cv-field="fullName" data-cv-change={changed('fullName')}>{intro.fullName || 'LE THANH HAI'}</h1>
    <p className="text-base font-bold mt-0.5" style={{ color: cv.design.accentColor }} data-cv-field="title" data-cv-change={changed('title')}>{intro.title || 'AI Engineer'}</p>
    <div className="flex flex-wrap items-center gap-x-3 text-xs text-slate-600 mt-2 font-medium">
      <span data-cv-field="email" data-cv-change={changed('email')}>{intro.email}</span>
      {intro.phone && <><span>•</span><span data-cv-field="phone" data-cv-change={changed('phone')}>{intro.phone}</span></>}
      {intro.location && <><span>•</span><RegisteredValue fieldKey="location" value={intro.location} change={changed('location')} /></>}
      {intro.website && <><span>•</span><span data-cv-field="website" data-cv-change={changed('website')}>{intro.website}</span></>}
    </div>
    {intro.availability && <p className="mt-1 text-xs text-slate-600"><RegisteredValue fieldKey="availability" value={intro.availability} label="Availability" change={changed('availability')} /></p>}
    {!context.layout.nodes.some((node) => node.type === 'summary' && node.visible) && intro.careerObjective && <p className="mt-2 text-xs text-slate-700"><RegisteredValue fieldKey="careerObjective" value={intro.careerObjective} change={changed('careerObjective')} /></p>}
  </>, 'header')
}

function renderSummary(context: RenderContext) {
  const { cv, variant } = context
  const { intro } = cv.sections
  const fallbackAvailability = !context.layout.nodes.some((node) => node.type === 'header' && node.visible)
  const fallbackLocation = !context.layout.nodes.some((node) => node.type === 'header' && node.visible)
  if (!intro.summary && !intro.careerObjective && !(fallbackAvailability && intro.availability) && !(fallbackLocation && intro.location)) return null
  const changed = (field: string) => context.changes?.[`intro.${field}`]
  const fallbackContact = fallbackLocation && <>{intro.website && <p><span data-cv-field="website" data-cv-change={changed('website')}>{intro.website}</span></p>}{intro.avatarUrl && <img className="cv-avatar" data-cv-field="avatarUrl" data-print-style="inline" src={intro.avatarUrl} alt="" />}</>
  if (variant === 'print') return nodeFrame(context, <section className="cv-section">{sectionHeading(context, sectionTitle(context.node.type, context.language ?? context.cv.language))}<p data-cv-field="summary" data-cv-change={changed('summary')}>{intro.summary}</p>{intro.careerObjective && <p><RegisteredValue fieldKey="careerObjective" value={intro.careerObjective} change={changed('careerObjective')} /></p>}{fallbackAvailability && <p><RegisteredValue fieldKey="availability" value={intro.availability} label="Availability" change={changed('availability')} /></p>}{fallbackLocation && <p><RegisteredValue fieldKey="location" value={intro.location} label="Location" change={changed('location')} /></p>}{fallbackContact}</section>)
  return nodeFrame(context, <div className="mb-6 text-slate-700">{sectionHeading(context, sectionTitle(context.node.type, context.language ?? context.cv.language))}<p data-cv-field="summary" data-cv-change={changed('summary')}>{intro.summary}</p>{intro.careerObjective && <p className="mt-1"><RegisteredValue fieldKey="careerObjective" value={intro.careerObjective} change={changed('careerObjective')} /></p>}{fallbackAvailability && <p className="mt-1"><RegisteredValue fieldKey="availability" value={intro.availability} label="Availability" change={changed('availability')} /></p>}{fallbackLocation && <p className="mt-1"><RegisteredValue fieldKey="location" value={intro.location} label="Location" change={changed('location')} /></p>}{fallbackContact}</div>)
}

function renderExperience(context: RenderContext) {
  const { cv, node, variant } = context
  const items = itemsForNode(context, orderedItems(cv.sections.experience, 'itemOrder' in node ? node.itemOrder : undefined))
  if (!items.length) return null
  const entries = items.map((item) => {
    const changed = changeAt(context, 'experience', item.id)
    const time = dateRange(item.startDate, item.current ? 'Present' : item.endDate)
    const slice = context.itemSlices?.[item.id]
    return <div className="cv-entry space-y-1" key={item.id} {...interactiveProps(context, item.id)}>
      {(!slice || slice.head) && <>
        <EntryHead
          title={<RegisteredValue fieldKey="role" value={item.title} change={changed('title')} />}
          organisation={item.company ? <RegisteredValue fieldKey="company" value={item.company} change={changed('company')} /> : null}
          date={time ? <RegisteredValue fieldKey="time" value={time} change={changed('startDate') ?? changed('endDate') ?? changed('current')} /> : null}
        />
        <div className="flex flex-wrap gap-x-3 text-xs"><RegisteredValue fieldKey="teamSize" value={item.teamSize} label="Team size" change={changed('teamSize')} /><RegisteredValue fieldKey="techStack" value={item.techStack} label="Tech stack" change={changed('techStack')} /></div>
      </>}
      <RegisteredHighlights itemId={item.id} values={item.highlights} indexes={slice?.highlights} changes={context.changes} changePath={`experience.${item.id}.highlights`} />
    </div>
  })
  if (variant === 'print') return nodeFrame(context, <section className="cv-section">{sectionHeading(context, sectionTitle(context.node.type, context.language ?? context.cv.language))}<div>{entries}</div></section>)
  return nodeFrame(context, <div className="mb-6">{sectionHeading(context, sectionTitle(context.node.type, context.language ?? context.cv.language))}<div className="space-y-4">{entries}</div></div>)
}

function renderProjects(context: RenderContext) {
  const { cv, node, variant } = context
  const items = itemsForNode(context, orderedItems(cv.sections.projects, 'itemOrder' in node ? node.itemOrder : undefined))
  if (!items.length) return null
  const entries = items.map((item) => {
    const changed = changeAt(context, 'projects', item.id)
    const time = dateRange(item.startDate, item.endDate)
    const slice = context.itemSlices?.[item.id]
    return <div className="cv-entry space-y-1" key={item.id} {...interactiveProps(context, item.id)}>
      {(!slice || slice.head) && <>
        <EntryHead
          title={<RegisteredValue fieldKey="name" value={item.name} change={changed('name')} />}
          organisation={item.role ? <RegisteredValue fieldKey="role" value={item.role} change={changed('role')} /> : null}
          date={time ? <RegisteredValue fieldKey="time" value={time} change={changed('startDate') ?? changed('endDate')} /> : null}
        />
        {item.link && <RegisteredValue fieldKey="link" value={item.link} change={changed('link')} />}
        <div className="flex flex-wrap gap-x-3 text-xs"><RegisteredValue fieldKey="teamSize" value={item.teamSize} label="Team size" change={changed('teamSize')} /><RegisteredValue fieldKey="techStack" value={item.techStack} label="Tech stack" change={changed('techStack')} /></div>
        {item.contribution && <p><RegisteredValue fieldKey="contribution" value={item.contribution} label="Contribution" change={changed('contribution')} /></p>}
      </>}
      <RegisteredHighlights itemId={item.id} values={item.highlights} indexes={slice?.highlights} changes={context.changes} changePath={`projects.${item.id}.highlights`} />
    </div>
  })
  if (variant === 'print') return nodeFrame(context, <section className="cv-section">{sectionHeading(context, sectionTitle(context.node.type, context.language ?? context.cv.language))}<div>{entries}</div></section>)
  return nodeFrame(context, <div className="mb-6">{sectionHeading(context, sectionTitle(context.node.type, context.language ?? context.cv.language))}<div className="space-y-3">{entries}</div></div>)
}

function renderEducation(context: RenderContext) {
  const { cv, node, variant } = context
  const items = itemsForNode(context, orderedItems(cv.sections.education, 'itemOrder' in node ? node.itemOrder : undefined))
  if (!items.length) return null
  const entries = items.map((item) => {
    const changed = changeAt(context, 'education', item.id)
    const time = dateRange(item.startDate, item.endDate)
    const slice = context.itemSlices?.[item.id]
    return <div className="cv-entry" key={item.id} {...interactiveProps(context, item.id)}>
      {(!slice || slice.head) && <>
        <EntryHead
          title={<RegisteredValue fieldKey="school" value={item.school} change={changed('school')} />}
          organisation={item.degree || item.fieldOfStudy ? <><RegisteredValue fieldKey="degree" value={item.degree} change={changed('degree')} />{item.degree && item.fieldOfStudy ? ' — ' : ''}<RegisteredValue fieldKey="field" value={item.fieldOfStudy} change={changed('fieldOfStudy')} /></> : null}
          date={time ? <RegisteredValue fieldKey="time" value={time} change={changed('startDate') ?? changed('endDate')} /> : null}
        />
        {item.gpa && <p><RegisteredValue fieldKey="gpa" value={item.gpa} label="GPA" change={changed('gpa')} /></p>}
      </>}
      <RegisteredHighlights itemId={item.id} values={item.highlights ?? []} indexes={slice?.highlights} changes={context.changes} changePath={`education.${item.id}.highlights`} />
    </div>
  })
  if (variant === 'print') return nodeFrame(context, <section className="cv-section">{sectionHeading(context, sectionTitle(context.node.type, context.language ?? context.cv.language))}<div>{entries}</div></section>)
  return nodeFrame(context, <div className="mb-6">{sectionHeading(context, sectionTitle(context.node.type, context.language ?? context.cv.language))}<div className="space-y-2">{entries}</div></div>)
}

function renderSkills(context: RenderContext) {
  const { cv, node, variant } = context
  if (!cv.sections.skills.length) return null
  const groups = orderedItems(cv.sections.skills, 'itemOrder' in node ? node.itemOrder : undefined)
  const skillsChange = (group: { id: string }) => changeAt(context, 'skills', group.id)('skills')
  if (variant === 'print') return nodeFrame(context, <section className="cv-section">{sectionHeading(context, sectionTitle(context.node.type, context.language ?? context.cv.language))}<div>{groups.map((group) => <p key={group.id} {...interactiveProps(context, group.id)}><strong><RegisteredValue fieldKey="category" value={group.category} change={changeAt(context, 'skills', group.id)('category')} />: </strong><span className="cv-skills"><span data-cv-field="skills" data-print-style="tags" data-cv-change={skillsChange(group)}>{group.skills.join(', ')}</span></span></p>)}</div></section>)
  return nodeFrame(context, <div className="mb-6">{sectionHeading(context, sectionTitle(context.node.type, context.language ?? context.cv.language))}<div className="space-y-1.5 text-slate-800">{groups.map((group) => <div key={group.id} className="flex" {...interactiveProps(context, group.id)}><span className="font-bold w-40 shrink-0 text-slate-900"><RegisteredValue fieldKey="category" value={group.category} change={changeAt(context, 'skills', group.id)('category')} />:</span><span className="text-slate-700"><span data-cv-field="skills" data-print-style="tags" data-cv-change={skillsChange(group)}>{group.skills.join(', ')}</span></span></div>)}</div></div>)
}

function renderActivities(context: RenderContext) {
  const { cv, node, variant } = context
  if (!cv.sections.activities.length) return null
  const entries = orderedItems(cv.sections.activities, 'itemOrder' in node ? node.itemOrder : undefined).map((item) => {
    const changed = changeAt(context, 'activities', item.id)
    const time = dateRange(item.startDate, item.endDate)
    return <div className="cv-entry" key={item.id} {...interactiveProps(context, item.id)}>
      <EntryHead
        title={<RegisteredValue fieldKey="organization" value={item.organization} change={changed('organization')} />}
        organisation={item.role ? <RegisteredValue fieldKey="role" value={item.role} change={changed('role')} /> : null}
        date={time ? <RegisteredValue fieldKey="time" value={time} change={changed('startDate') ?? changed('endDate')} /> : null}
      />
      <RegisteredHighlights itemId={item.id} values={item.highlights} changes={context.changes} changePath={`activities.${item.id}.highlights`} />
    </div>
  })
  if (variant === 'print') return nodeFrame(context, <section className="cv-section">{sectionHeading(context, sectionTitle(context.node.type, context.language ?? context.cv.language))}<div>{entries}</div></section>)
  return nodeFrame(context, <div className="mb-6">{sectionHeading(context, sectionTitle(context.node.type, context.language ?? context.cv.language))}<div className="space-y-2">{entries}</div></div>)
}

function renderCertifications(context: RenderContext) {
  const { cv, node, variant } = context
  if (!cv.sections.certifications.length) return null
  const entries = orderedItems(cv.sections.certifications, 'itemOrder' in node ? node.itemOrder : undefined).map((item) => {
    const changed = changeAt(context, 'certifications', item.id)
    return <div className="cv-entry" key={item.id} {...interactiveProps(context, item.id)}>
      <EntryHead
        title={<RegisteredValue fieldKey="name" value={item.name} change={changed('name')} />}
        organisation={item.issuer ? <RegisteredValue fieldKey="issuer" value={item.issuer} change={changed('issuer')} /> : null}
        date={item.date ? <RegisteredValue fieldKey="date" value={item.date} change={changed('date')} /> : null}
      />
      {item.link && <RegisteredValue fieldKey="link" value={item.link} change={changed('link')} />}
    </div>
  })
  if (variant === 'print') return nodeFrame(context, <section className="cv-section">{sectionHeading(context, sectionTitle(context.node.type, context.language ?? context.cv.language))}<div>{entries}</div></section>)
  return nodeFrame(context, <div className="mb-6">{sectionHeading(context, sectionTitle(context.node.type, context.language ?? context.cv.language))}<div className="space-y-1 text-slate-700">{entries}</div></div>)
}

function renderLanguages(context: RenderContext) {
  const { cv, node, variant } = context
  if (!cv.sections.languages.length) return null
  const languages = orderedItems(cv.sections.languages, 'itemOrder' in node ? node.itemOrder : undefined)
  if (variant === 'print') return nodeFrame(context, <section className="cv-section">{sectionHeading(context, sectionTitle(context.node.type, context.language ?? context.cv.language))}<div className="cv-skills">{languages.map((item) => <span className="cv-skill" key={item.id} {...interactiveProps(context, item.id)}><RegisteredValue fieldKey="language" value={item.language} change={changeAt(context, 'languages', item.id)('language')} /> — <RegisteredValue fieldKey="proficiency" value={item.proficiency} change={changeAt(context, 'languages', item.id)('proficiency')} /></span>)}</div></section>)
  return nodeFrame(context, <div className="mb-6">{sectionHeading(context, sectionTitle(context.node.type, context.language ?? context.cv.language))}<ul className="text-slate-700 space-y-1">{languages.map((item) => <li key={item.id} className="flex justify-between" {...interactiveProps(context, item.id)}><span className="font-bold text-slate-900"><RegisteredValue fieldKey="language" value={item.language} change={changeAt(context, 'languages', item.id)('language')} />:</span><span className="text-slate-600"><RegisteredValue fieldKey="proficiency" value={item.proficiency} change={changeAt(context, 'languages', item.id)('proficiency')} /></span></li>)}</ul></div>)
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
export function CVBlockRenderer({ cv, layout, variant, onSelect, onEdit, nodeIds, itemIds, itemSlices, selectedNodeId, selectedItemId, changes, language }: CVBlockRendererProps) {
  const nodeIdSet = nodeIds ? new Set(nodeIds) : undefined
  return <>{layout.nodes.filter((node) => node.visible && (!nodeIdSet || nodeIdSet.has(node.id))).map((node) => <React.Fragment key={node.id}>{nodeRenderers[node.type]({ cv, layout, variant, onSelect, onEdit, node, itemIds, itemSlices, selectedNodeId, selectedItemId, changes, language })}</React.Fragment>)}</>
}
