import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocale } from './i18n'
import type { CV, CVLayout, LayoutNode } from '../types'
import { ApiError, commitCV, getCV, restoreCVRevision } from './api'
import { validateCVFieldPlacement } from './cv-fields'
import { normalizeLayout, synchronizeCVActiveSections } from './layout-draft'

export type CVStoreStatus = 'loading' | 'ready' | 'dirty' | 'saving' | 'saved' | 'error'

export interface DraftDocument {
  cv: CV
  layout: CVLayout
}

export type CVFieldDraftValue = string | string[] | { start: string; end: string }

function updateItem<T extends { id: string }>(items: T[], itemId: string | undefined, update: (item: T) => T): T[] | undefined {
  if (!itemId || !items.some((item) => item.id === itemId)) return undefined
  return items.map((item) => item.id === itemId ? update(item) : item)
}

/** Resolve a registered field from its canonical typed CV property. */
export function getCVFieldDraftValue(draft: CV, node: LayoutNode, itemId: string | undefined, key: string): CVFieldDraftValue {
  validateCVFieldPlacement(key, node.type)
  const intro = draft.sections.intro
  if (node.type === 'header' || node.type === 'summary') {
    if (key === 'fullName') return intro.fullName
    if (key === 'title') return intro.title
    if (key === 'email') return intro.email
    if (key === 'phone') return intro.phone
    if (key === 'summary') return intro.summary
    if (key === 'careerObjective') return intro.careerObjective ?? ''
    if (key === 'availability') return intro.availability ?? ''
    if (key === 'location') return intro.location
    if (key === 'website') return intro.website ?? ''
    if (key === 'avatarUrl') return intro.avatarUrl ?? ''
  }
  if (node.type === 'experience') {
    const item = draft.sections.experience.find((candidate) => candidate.id === itemId)
    if (!item) return ''
    if (key === 'role') return item.title
    if (key === 'company') return item.company
    if (key === 'time') return { start: item.startDate, end: item.endDate }
    if (key === 'highlights') return item.highlights.join('\n')
    if (key === 'teamSize') return item.teamSize ?? ''
    if (key === 'techStack') return item.techStack ?? []
  }
  if (node.type === 'projects') {
    const item = draft.sections.projects.find((candidate) => candidate.id === itemId)
    if (!item) return ''
    if (key === 'name') return item.name
    if (key === 'role') return item.role
    if (key === 'time') return { start: item.startDate, end: item.endDate }
    if (key === 'highlights') return item.highlights.join('\n')
    if (key === 'teamSize') return item.teamSize ?? ''
    if (key === 'techStack') return item.techStack ?? []
    if (key === 'contribution') return item.contribution ?? ''
    if (key === 'link') return item.link ?? ''
  }
  if (node.type === 'education') {
    const item = draft.sections.education.find((candidate) => candidate.id === itemId)
    if (!item) return ''
    if (key === 'school') return item.school
    if (key === 'degree') return item.degree
    if (key === 'field') return item.fieldOfStudy
    if (key === 'gpa') return item.gpa ?? ''
    if (key === 'time') return { start: item.startDate, end: item.endDate }
    if (key === 'highlights') return item.highlights.join('\n')
  }
  if (node.type === 'skills') {
    const item = draft.sections.skills.find((candidate) => candidate.id === itemId)
    if (!item) return ''
    if (key === 'category') return item.category
    if (key === 'skills') return item.skills
  }
  if (node.type === 'activities') {
    const item = draft.sections.activities.find((candidate) => candidate.id === itemId)
    if (!item) return ''
    if (key === 'organization') return item.organization
    if (key === 'role') return item.role
    if (key === 'time') return { start: item.startDate, end: item.endDate }
    if (key === 'highlights') return item.highlights.join('\n')
  }
  if (node.type === 'certifications') {
    const item = draft.sections.certifications.find((candidate) => candidate.id === itemId)
    if (!item) return ''
    if (key === 'name') return item.name
    if (key === 'issuer') return item.issuer
    if (key === 'date') return item.date
    if (key === 'link') return item.link ?? ''
  }
  if (node.type === 'languages') {
    const item = draft.sections.languages.find((candidate) => candidate.id === itemId)
    if (!item) return ''
    if (key === 'language') return item.language
    if (key === 'proficiency') return item.proficiency
  }
  return ''
}

/** Apply one validated catalog field with immutable section and item updates. */
export function updateCVFieldDraft(draft: CV, node: LayoutNode, itemId: string | undefined, key: string, value: CVFieldDraftValue): CV {
  validateCVFieldPlacement(key, node.type)
  const text = typeof value === 'string' ? value : ''
  if (node.type === 'header' || node.type === 'summary') {
    const field = key === 'fullName' ? 'fullName' : key === 'title' ? 'title' : key === 'email' ? 'email' : key === 'phone' ? 'phone' : key === 'summary' ? 'summary' : key === 'careerObjective' ? 'careerObjective' : key === 'availability' ? 'availability' : key === 'location' ? 'location' : key === 'website' ? 'website' : key === 'avatarUrl' ? 'avatarUrl' : undefined
    if (!field) return draft
    return { ...draft, sections: { ...draft.sections, intro: { ...draft.sections.intro, [field]: text } } }
  }
  if (node.type === 'experience') {
    const experience = updateItem(draft.sections.experience, itemId, (item) => {
      if (key === 'role') return { ...item, title: text }
      if (key === 'company') return { ...item, company: text }
      if (key === 'time' && typeof value !== 'string' && !Array.isArray(value)) return { ...item, startDate: value.start, endDate: value.end }
      if (key === 'highlights') return { ...item, highlights: text.split('\n').map((line) => line.trim()).filter(Boolean) }
      if (key === 'teamSize') return { ...item, teamSize: text || undefined }
      if (key === 'techStack') return { ...item, techStack: Array.isArray(value) && value.length ? value : undefined }
      return item
    })
    return experience ? { ...draft, sections: { ...draft.sections, experience } } : draft
  }
  if (node.type === 'projects') {
    const projects = updateItem(draft.sections.projects, itemId, (item) => {
      if (key === 'name') return { ...item, name: text }
      if (key === 'role') return { ...item, role: text }
      if (key === 'time' && typeof value !== 'string' && !Array.isArray(value)) return { ...item, startDate: value.start, endDate: value.end }
      if (key === 'highlights') return { ...item, highlights: text.split('\n').map((line) => line.trim()).filter(Boolean) }
      if (key === 'teamSize') return { ...item, teamSize: text || undefined }
      if (key === 'techStack') return { ...item, techStack: Array.isArray(value) && value.length ? value : undefined }
      if (key === 'contribution') return { ...item, contribution: text || undefined }
      if (key === 'link') return { ...item, link: text || undefined }
      return item
    })
    return projects ? { ...draft, sections: { ...draft.sections, projects } } : draft
  }
  if (node.type === 'education') {
    const education = updateItem(draft.sections.education, itemId, (item) => {
      if (key === 'school') return { ...item, school: text }
      if (key === 'degree') return { ...item, degree: text }
      if (key === 'field') return { ...item, fieldOfStudy: text }
      if (key === 'gpa') return { ...item, gpa: text || undefined }
      if (key === 'time' && typeof value !== 'string' && !Array.isArray(value)) return { ...item, startDate: value.start, endDate: value.end }
      if (key === 'highlights') return { ...item, highlights: text.split('\n').map((line) => line.trim()).filter(Boolean) }
      return item
    })
    return education ? { ...draft, sections: { ...draft.sections, education } } : draft
  }
  if (node.type === 'skills') {
    const skills = updateItem(draft.sections.skills, itemId, (item) => {
      if (key === 'category') return { ...item, category: text }
      if (key === 'skills') return { ...item, skills: Array.isArray(value) ? value : [] }
      return item
    })
    return skills ? { ...draft, sections: { ...draft.sections, skills } } : draft
  }
  if (node.type === 'activities') {
    const activities = updateItem(draft.sections.activities, itemId, (item) => {
      if (key === 'organization') return { ...item, organization: text }
      if (key === 'role') return { ...item, role: text }
      if (key === 'time' && typeof value !== 'string' && !Array.isArray(value)) return { ...item, startDate: value.start, endDate: value.end }
      if (key === 'highlights') return { ...item, highlights: text.split('\n').map((line) => line.trim()).filter(Boolean) }
      return item
    })
    return activities ? { ...draft, sections: { ...draft.sections, activities } } : draft
  }
  if (node.type === 'certifications') {
    const certifications = updateItem(draft.sections.certifications, itemId, (item) => {
      if (key === 'name') return { ...item, name: text }
      if (key === 'issuer') return { ...item, issuer: text }
      if (key === 'date') return { ...item, date: text }
      if (key === 'link') return { ...item, link: text || undefined }
      return item
    })
    return certifications ? { ...draft, sections: { ...draft.sections, certifications } } : draft
  }
  if (node.type === 'languages') {
    const languages = updateItem(draft.sections.languages, itemId, (item) => {
      if (key === 'language') return { ...item, language: text }
      if (key === 'proficiency') return { ...item, proficiency: text }
      return item
    })
    return languages ? { ...draft, sections: { ...draft.sections, languages } } : draft
  }
  return draft
}

interface DocumentState {
  committed: DraftDocument | null
  draft: DraftDocument | null
}

interface ProvenanceChange {
  path: string
  before?: unknown
  after?: unknown
  exists: boolean
  arrayParentPath?: string
  arrayKind?: 'add' | 'remove' | 'replace' | 'reorder'
  arrayValue?: unknown
  arrayBaselineCount?: number
  arrayOrder?: unknown[]
  arrayOrderValues?: unknown[]
  arrayOrderRelations?: Array<{ beforeToken: number; afterToken: number; before: unknown; after: unknown }>
  arrayBaselineValues?: unknown[]
  arrayItemId?: string
  arrayItemCollectionPath?: string
  arrayItemParentPath?: string
  arrayItemFieldPath?: string
  scalarDelta?: { removedBefore: string; insertedAfter: string; position: number; afterOccurrence: number }
  scalarAnchor?: { start: number; end: number }
}
interface ProvenanceEntry { id: number; summary: string; changes: ProvenanceChange[] }

const emptyDocuments: DocumentState = { committed: null, draft: null }

function cloneDocument(document: DraftDocument): DraftDocument {
  return JSON.parse(JSON.stringify(document)) as DraftDocument
}

function cloneValue(value: unknown): unknown {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

function primitiveOrderMatches(before: unknown[], after: unknown[]): { tokens: number[]; values: unknown[] } {
  const remaining = before.map((_, index) => index)
  const tokens: number[] = []
  const values: unknown[] = []
  for (const value of after) {
    let match = remaining.findIndex((index) => deepEqual(before[index], value))
    if (match < 0 && before.length === after.length && remaining.length) match = 0
    if (match >= 0) {
      tokens.push(remaining.splice(match, 1)[0]!)
      values.push(value)
    }
  }
  return { tokens, values }
}

function primitiveOrderTokens(before: unknown[], after: unknown[]): number[] {
  return primitiveOrderMatches(before, after).tokens
}

function primitiveOrderRelations(baseline: unknown[], match: { tokens: number[]; values: unknown[] }): Array<{ beforeToken: number; afterToken: number; before: unknown; after: unknown }> {
  const relations: Array<{ beforeToken: number; afterToken: number; before: unknown; after: unknown }> = []
  for (let left = 0; left < match.tokens.length; left += 1) {
    for (let right = left + 1; right < match.tokens.length; right += 1) {
      const beforeToken = match.tokens[left]!
      const afterToken = match.tokens[right]!
      if (beforeToken <= afterToken || deepEqual(baseline[beforeToken], baseline[afterToken])) continue
      if (!relations.some((relation) => relation.beforeToken === beforeToken && relation.afterToken === afterToken)) {
        relations.push({ beforeToken, afterToken, before: cloneValue(baseline[beforeToken]), after: cloneValue(baseline[afterToken]) })
      }
    }
  }
  return relations
}

function hasPrimitiveOrderRelation(baseline: unknown[], target: unknown[], relation: { beforeToken: number; afterToken: number; before: unknown; after: unknown }): boolean {
  const tokens = primitiveOrderMatches(baseline, target).tokens
  const beforeIndex = tokens.indexOf(relation.beforeToken)
  const afterIndex = tokens.indexOf(relation.afterToken)
  if (beforeIndex >= 0 && afterIndex >= 0 && beforeIndex < afterIndex) return true
  if (baseline.filter((value) => deepEqual(value, relation.before)).length > 1) return false
  return target.some((value, index) => deepEqual(value, relation.before) && target.slice(index + 1).some((after) => deepEqual(after, relation.after)))
}

function multisetDifference(source: unknown[], target: unknown[]): unknown[] {
  const remaining = [...target]
  return source.filter((value) => {
    const match = remaining.findIndex((candidate) => deepEqual(candidate, value))
    if (match < 0) return true
    remaining.splice(match, 1)
    return false
  })
}

function collectChanges(before: unknown, after: unknown, path = '', arrayParentPath?: string, arrayItemId?: string, arrayItemRootPath?: string, arrayItemCollectionPath?: string): ProvenanceChange[] {
  if (deepEqual(before, after)) return []
  if (Array.isArray(after) && !Array.isArray(before)) {
    return after.map((value, index) => ({ path: `${path}/${index}`, after: cloneValue(value), exists: true, arrayParentPath: path, arrayKind: 'add' as const, arrayValue: cloneValue(value), arrayBaselineCount: 0, arrayItemId, arrayItemCollectionPath, arrayItemParentPath: arrayItemRootPath && path.startsWith(arrayItemRootPath) ? path.slice(arrayItemRootPath.length) : undefined }))
  }
  if (Array.isArray(before) && !Array.isArray(after)) {
    return before.map((value) => ({ path, before: cloneValue(value), exists: false, arrayParentPath: path, arrayKind: 'remove' as const, arrayValue: cloneValue(value), arrayBaselineCount: before.filter((candidate) => deepEqual(candidate, value)).length, arrayItemId, arrayItemCollectionPath, arrayItemParentPath: arrayItemRootPath && path.startsWith(arrayItemRootPath) ? path.slice(arrayItemRootPath.length) : undefined }))
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const beforeArray = before
    const afterArray = after
    const beforeItems = beforeArray.filter((value): value is { id: string } => Boolean(value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string'))
    const afterItems = afterArray.filter((value): value is { id: string } => Boolean(value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string'))
    const stableItems = beforeItems.length === beforeArray.length && afterItems.length === afterArray.length && beforeItems.every((item) => item.id) && afterItems.every((item) => item.id)
    if (stableItems) {
      const beforeIDs = beforeItems.map((item) => item.id)
      const afterIDs = afterItems.map((item) => item.id)
      const beforeByID = new Map(beforeItems.map((item) => [item.id, item]))
      const afterByID = new Map(afterItems.map((item) => [item.id, item]))
      const changes: ProvenanceChange[] = []
      const commonBefore = beforeIDs.filter((id) => afterByID.has(id))
      const commonAfter = afterIDs.filter((id) => beforeByID.has(id))
      if (commonBefore.length === commonAfter.length && commonBefore.some((id, index) => id !== commonAfter[index])) {
        changes.push({ path, exists: true, arrayParentPath: path, arrayKind: 'reorder', arrayOrder: cloneValue(commonAfter) as unknown[] })
      }
      for (const id of afterIDs) {
        const currentIndex = afterIDs.indexOf(id)
        const previous = beforeByID.get(id)
        if (!previous) {
          changes.push({ path: `${path}/${currentIndex}`, after: cloneValue(afterByID.get(id)), exists: true, arrayParentPath: path, arrayKind: 'add', arrayValue: cloneValue(afterByID.get(id)), arrayBaselineCount: 0, arrayItemId: id, arrayItemCollectionPath: path })
          continue
        }
        changes.push(...collectChanges(previous, afterByID.get(id), `${path}/${currentIndex}`, path, id, `${path}/${currentIndex}`, path))
      }
      for (const id of beforeIDs) {
        if (!afterByID.has(id)) changes.push({ path, exists: false, arrayParentPath: path, arrayKind: 'remove', arrayValue: cloneValue(beforeByID.get(id)), arrayBaselineCount: 1, arrayItemId: id, arrayItemCollectionPath: path })
      }
      return changes
    }
    const orderMatch = primitiveOrderMatches(beforeArray, afterArray)
    const orderTokens = orderMatch.tokens
    const sortedOrderTokens = [...orderTokens].sort((left, right) => left - right)
    const orderChanged = orderTokens.length > 1 && orderTokens.some((token, index) => token !== sortedOrderTokens[index])
    const orderChange: ProvenanceChange | undefined = orderChanged ? {
      path, exists: true, arrayParentPath: path, arrayKind: 'reorder', arrayOrder: orderTokens, arrayOrderValues: cloneValue(orderMatch.values) as unknown[],
      arrayOrderRelations: primitiveOrderRelations(beforeArray, orderMatch),
      arrayBaselineValues: cloneValue(beforeArray) as unknown[], arrayItemId, arrayItemCollectionPath,
      arrayItemParentPath: arrayItemRootPath && path.startsWith(arrayItemRootPath) ? path.slice(arrayItemRootPath.length) : undefined,
    } : undefined
    const additions = multisetDifference(afterArray, beforeArray).map((value) => ({ path, after: cloneValue(value), exists: true, arrayParentPath: path, arrayKind: 'add' as const, arrayValue: cloneValue(value), arrayBaselineCount: beforeArray.filter((candidate) => deepEqual(candidate, value)).length, arrayItemId, arrayItemCollectionPath, arrayItemParentPath: arrayItemRootPath && path.startsWith(arrayItemRootPath) ? path.slice(arrayItemRootPath.length) : undefined }))
    const removals = multisetDifference(beforeArray, afterArray).map((value) => ({ path, before: cloneValue(value), exists: false, arrayParentPath: path, arrayKind: 'remove' as const, arrayValue: cloneValue(value), arrayBaselineCount: beforeArray.filter((candidate) => deepEqual(candidate, value)).length, arrayItemId, arrayItemCollectionPath, arrayItemParentPath: arrayItemRootPath && path.startsWith(arrayItemRootPath) ? path.slice(arrayItemRootPath.length) : undefined }))
    if (orderChange || additions.length || removals.length) return [...(orderChange ? [orderChange] : []), ...additions, ...removals]
    return []
  }
  if (before && after && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before) && !Array.isArray(after)) {
    const beforeRecord = before as Record<string, unknown>
    const afterRecord = after as Record<string, unknown>
    const keys = new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)])
    return [...keys].flatMap((key) => {
      const childPath = `${path}/${key}`
      if (!Object.prototype.hasOwnProperty.call(afterRecord, key)) {
        return [{ path: childPath, before: cloneValue(beforeRecord[key]), exists: false, arrayParentPath, arrayItemId, arrayItemCollectionPath, arrayItemFieldPath: arrayItemRootPath && childPath.startsWith(arrayItemRootPath) ? childPath.slice(arrayItemRootPath.length) : undefined }]
      }
      return collectChanges(beforeRecord[key], afterRecord[key], childPath, arrayParentPath, arrayItemId, arrayItemRootPath, arrayItemCollectionPath)
    })
  }
  const scalarDelta = typeof before === 'string' && typeof after === 'string' ? scalarDeltaFor(before, after) : undefined
  return [{
    path,
    before: cloneValue(before),
    after: cloneValue(after),
    exists: true,
    arrayParentPath,
    arrayItemId,
    arrayItemCollectionPath,
    arrayItemFieldPath: arrayItemRootPath && path.startsWith(arrayItemRootPath) ? path.slice(arrayItemRootPath.length) : undefined,
    scalarDelta,
    scalarAnchor: scalarDelta ? { start: scalarDelta.position, end: scalarDelta.position + scalarDelta.insertedAfter.length } : undefined,
  }]
}

function valueAtPath(value: unknown, path: string): { exists: boolean; value?: unknown } {
  if (!path) return { exists: true, value }
  let current: unknown = value
  for (const key of path.slice(1).split('/')) {
    if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, key)) return { exists: false }
    current = (current as Record<string, unknown>)[key]
  }
  return { exists: true, value: current }
}

function resolveChangeValue(document: DraftDocument, change: ProvenanceChange): { exists: boolean; value?: unknown } {
  if (change.arrayItemId && change.arrayItemCollectionPath && change.arrayItemFieldPath) {
    const collection = valueAtPath(document, change.arrayItemCollectionPath)
    if (!collection.exists || !Array.isArray(collection.value)) return { exists: false }
    const item = collection.value.find((value) => Boolean(value && typeof value === 'object' && (value as { id?: unknown }).id === change.arrayItemId))
    if (!item) return { exists: false }
    return valueAtPath(item, change.arrayItemFieldPath)
  }
  return valueAtPath(document, change.path)
}

interface StringEdit {
  oldStart: number
  oldEnd: number
  newStart: number
  newEnd: number
}

function stringEditFor(before: string, after: string): StringEdit {
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1
  let suffix = 0
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix += 1
  return {
    oldStart: prefix,
    oldEnd: before.length - suffix,
    newStart: prefix,
    newEnd: after.length - suffix,
  }
}

function rebaseScalarAnchor(anchor: { start: number; end: number }, before: string, after: string): { start: number; end: number } | undefined {
  if (before === after) return anchor
  const edit = stringEditFor(before, after)
  const insertedLength = edit.newEnd - edit.newStart
  const removedLength = edit.oldEnd - edit.oldStart
  const shift = insertedLength - removedLength

  // A removed AI span is represented by a gap. Insertions at that gap are
  // considered manual text before the remaining baseline and move the gap
  // after the inserted text. This preserves the occurrence identity when a
  // user prefixes a repeated value.
  if (anchor.start === anchor.end) {
    if (removedLength === 0 && edit.oldStart === anchor.start) return { start: anchor.start + insertedLength, end: anchor.end + insertedLength }
    if (edit.oldEnd <= anchor.start) return { start: anchor.start + shift, end: anchor.end + shift }
    if (edit.oldStart > anchor.start) return anchor
    return { start: edit.newStart, end: edit.newStart }
  }

  // An edit wholly before or after the authored span only shifts its
  // position. An edit inside the span is allowed to extend it for manual
  // insertions, but deleting any authored characters removes the contribution.
  if (edit.oldEnd <= anchor.start) return { start: anchor.start + shift, end: anchor.end + shift }
  if (edit.oldStart >= anchor.end) return anchor
  if (removedLength > 0) return undefined
  if (edit.oldStart <= anchor.start) return { start: anchor.start + insertedLength, end: anchor.end + insertedLength }
  if (edit.oldStart < anchor.end) return { start: anchor.start, end: anchor.end + insertedLength }
  return anchor
}

function rebaseScalarChange(change: ProvenanceChange, previous: DraftDocument, next: DraftDocument): ProvenanceChange | undefined {
  if (!change.scalarDelta || !change.scalarAnchor) return change
  const previousValue = resolveChangeValue(previous, change)
  const nextValue = resolveChangeValue(next, change)
  if (typeof previousValue.value !== 'string' || typeof nextValue.value !== 'string') return change
  if (nextValue.value === change.before) return undefined
  const edit = stringEditFor(previousValue.value, nextValue.value)
  if (change.scalarAnchor.start === change.scalarAnchor.end
    && edit.oldStart === change.scalarAnchor.start
    && edit.oldEnd === edit.oldStart
    && edit.newEnd > edit.newStart
    && (typeof change.after !== 'string' || !change.after || !nextValue.value.endsWith(change.after))) return undefined
  const anchor = rebaseScalarAnchor(change.scalarAnchor, previousValue.value, nextValue.value)
  return anchor ? { ...change, scalarAnchor: anchor } : undefined
}

function rebaseProvenanceEntries(entries: ProvenanceEntry[], previous: DraftDocument, next: DraftDocument): ProvenanceEntry[] {
  return entries.map((entry) => ({
    ...entry,
    changes: entry.changes.flatMap((change) => {
      const rebased = rebaseScalarChange(change, previous, next)
      return rebased ? [rebased] : []
    }),
  })).filter((entry) => entry.changes.length > 0)
}

function reconcileProvenance(entries: ProvenanceEntry[], draft: DraftDocument, previous?: DraftDocument): ProvenanceEntry[] {
  const rebasedEntries = previous ? rebaseProvenanceEntries(entries, previous, draft) : entries
  return rebasedEntries.map((entry) => ({ ...entry, changes: entry.changes.filter((change) => {
    if (change.arrayKind && change.arrayParentPath) {
      let target: unknown[] | undefined
      if (change.arrayItemId && change.arrayItemCollectionPath) {
        const collection = valueAtPath(draft, change.arrayItemCollectionPath)
        if (!collection.exists || !Array.isArray(collection.value)) return false
        const item = collection.value.find((value) => Boolean(value && typeof value === 'object' && (value as { id?: unknown }).id === change.arrayItemId))
        if (!change.arrayItemParentPath) return change.arrayKind === 'add' ? Boolean(item) : !item
        if (!item) return false
        const nested = valueAtPath(item, change.arrayItemParentPath)
        if (!nested.exists || !Array.isArray(nested.value)) return false
        target = nested.value
      } else {
        const parent = valueAtPath(draft, change.arrayParentPath)
        if (!parent.exists || !Array.isArray(parent.value)) return false
        target = parent.value
      }
      if (!target) return false
      if (change.arrayKind === 'reorder') {
        if (change.arrayOrderRelations) return change.arrayOrderRelations.some((relation) => hasPrimitiveOrderRelation(change.arrayBaselineValues ?? [], target, relation))
        if (change.arrayBaselineValues) {
          const tokens = primitiveOrderTokens(change.arrayBaselineValues, target)
          const expectedOrder = (change.arrayOrder ?? []).filter((_, index) => {
            const orderValue = change.arrayOrderValues?.[index]
            return orderValue === undefined || target.some((value) => deepEqual(value, orderValue))
          })
          let orderIndex = 0
          for (const token of tokens) if (token === expectedOrder[orderIndex]) orderIndex += 1
          return orderIndex === expectedOrder.length
        }
        let orderIndex = 0
        return target.every((value) => {
          if (orderIndex >= (change.arrayOrder?.length ?? 0)) return true
          const expected = change.arrayOrder?.[orderIndex]
          const comparable = value && typeof value === 'object' && typeof expected === 'string' ? (value as { id?: unknown }).id : value
          if (deepEqual(comparable, expected)) orderIndex += 1
          return true
        }) && orderIndex === change.arrayOrder?.length
      }
      const count = target.filter((value) => deepEqual(value, change.arrayValue)).length
      return change.arrayKind === 'add' || change.arrayKind === 'replace' ? count > (change.arrayBaselineCount ?? 0) : count < (change.arrayBaselineCount ?? 1)
    }
    if (change.arrayItemId && change.arrayItemCollectionPath && change.arrayItemFieldPath) {
      const parent = valueAtPath(draft, change.arrayItemCollectionPath)
      if (!parent.exists || !Array.isArray(parent.value)) return false
      const item = parent.value.find((value) => Boolean(value && typeof value === 'object' && (value as { id?: unknown }).id === change.arrayItemId))
      if (!item) return false
      const currentField = valueAtPath(item, change.arrayItemFieldPath)
      return change.exists ? currentField.exists && valueContributionSurvives(currentField.value, change) : !currentField.exists
    }
    const current = valueAtPath(draft, change.path)
    if (change.arrayParentPath && change.exists && change.after !== undefined) {
      const parent = valueAtPath(draft, change.arrayParentPath)
      if (parent.exists && Array.isArray(parent.value) && parent.value.some((value) => deepEqual(value, change.after))) return true
    }
    return change.exists
      ? current.exists && valueContributionSurvives(current.value, change)
      : !current.exists
  }) })).filter((entry) => entry.changes.length > 0)
}

function valueContributionSurvives(current: unknown, change: ProvenanceChange): boolean {
  if (deepEqual(current, change.after)) return true
  if (typeof current === 'string' && typeof change.before === 'string' && typeof change.after === 'string') {
    const delta = change.scalarDelta ?? scalarDeltaFor(change.before, change.after)
    const anchor = change.scalarAnchor
    if (!anchor) return false
    if (delta.insertedAfter) return current.slice(anchor.start, anchor.end).includes(delta.insertedAfter)
    return current.slice(anchor.start, anchor.start + delta.removedBefore.length) !== delta.removedBefore
  }
  return false
}

function changeMatchesNetChange(change: ProvenanceChange, netChanges: ProvenanceChange[]): boolean {
  return netChanges.some((net) => {
    if (change.arrayKind && change.arrayParentPath) {
      if (net.arrayParentPath !== change.arrayParentPath || net.arrayKind !== change.arrayKind) return false
      if (change.arrayKind === 'reorder') return true
      return deepEqual(net.arrayValue, change.arrayValue)
    }
    return net.path === change.path
  })
}

function sameLogicalChange(left: ProvenanceChange, right: ProvenanceChange): boolean {
  if (left.arrayItemId && right.arrayItemId && left.arrayItemCollectionPath && right.arrayItemCollectionPath && left.arrayItemFieldPath && right.arrayItemFieldPath) {
    return left.arrayItemId === right.arrayItemId
      && left.arrayItemCollectionPath === right.arrayItemCollectionPath
      && left.arrayItemFieldPath === right.arrayItemFieldPath
  }
  return left.path === right.path
}

function stringOccurrences(value: string, needle: string): number[] {
  if (!needle) return []
  const positions: number[] = []
  for (let index = value.indexOf(needle); index >= 0; index = value.indexOf(needle, index + 1)) positions.push(index)
  return positions
}

function scalarDeltaFor(before: string, after: string): { removedBefore: string; insertedAfter: string; position: number; afterOccurrence: number } {
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1
  let suffix = 0
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix += 1
  if (suffix < 3) suffix = 0
  const removedBefore = before.slice(prefix, before.length - suffix)
  const insertedAfter = after.slice(prefix, after.length - suffix)
  const anchor = insertedAfter || after
  return {
    removedBefore,
    insertedAfter,
    position: prefix,
    afterOccurrence: stringOccurrences(after, anchor).filter((index) => index <= prefix).length - 1,
  }
}

function scalarChangesCancel(change: ProvenanceChange, prior: ProvenanceChange): boolean {
  if (change.arrayKind || prior.arrayKind || !change.scalarDelta || !prior.scalarDelta || !change.scalarAnchor || !prior.scalarAnchor || !sameLogicalChange(change, prior)) return false
  const current = change.scalarDelta
  const previous = prior.scalarDelta
  const authored = prior.scalarAnchor
  const changedStart = current.position
  const changedEnd = current.position + current.removedBefore.length

  // A later AI insertion at a removed gap restores the exact removed
  // occurrence. The gap anchor is already rebased through manual prefixes.
  if (!previous.insertedAfter && current.insertedAfter) {
    return current.insertedAfter === previous.removedBefore
      && changedStart === authored.start
      && changedEnd === authored.end
  }

  // A later AI removal of the exact authored span cancels an earlier
  // insertion/replacement. A replacement is only inverse when it restores
  // the old text at the same occurrence.
  if (previous.insertedAfter && current.removedBefore) {
    return current.removedBefore === previous.insertedAfter
      && changedStart === authored.start
      && changedEnd === authored.end
      && (!current.insertedAfter || current.insertedAfter === previous.removedBefore)
  }

  return false
}

function scalarDeltaCandidates(value: string, delta: { removedBefore: string; insertedAfter: string }): string[] {
  return stringOccurrences(value, delta.insertedAfter).flatMap((index) => [
    `${value.slice(0, index)}${delta.removedBefore}${value.slice(index + delta.insertedAfter.length)}`,
    `${value.slice(0, index)}${value.slice(index + delta.insertedAfter.length)}`,
  ])
}

function cancelledPriorScalarChanges(change: ProvenanceChange, immediateBefore: unknown, priorChanges: ProvenanceChange[]): ProvenanceChange[] {
  if (change.arrayKind || typeof immediateBefore !== 'string' || typeof change.after !== 'string') return []
  const beforeValue = immediateBefore
  const afterValue = change.after
  return priorChanges.filter((prior) => {
    if (prior.arrayKind || typeof prior.before !== 'string' || typeof prior.after !== 'string' || !sameLogicalChange(change, prior)) return false
    const delta = prior.scalarDelta ?? scalarDeltaFor(prior.before, prior.after)
    const residuals = delta.insertedAfter
      ? scalarDeltaCandidates(beforeValue, delta)
      : stringOccurrences(beforeValue, prior.after).map((index) => `${beforeValue.slice(0, index)}${delta.removedBefore}${beforeValue.slice(index)}`)
    return residuals.some((residual) => residual === afterValue || residual.trim() === afterValue.trim())
  })
}

function rebaseProvenanceAfterSuccessfulSave(entries: ProvenanceEntry[], committed: DraftDocument, draft: DraftDocument): ProvenanceEntry[] {
  const netChanges = collectChanges(committed, draft)
  return entries.flatMap((entry) => {
    const reconciled = reconcileProvenance([entry], draft)[0]
    if (!reconciled) return []
    const changes = reconciled.changes.filter((change) => changeMatchesNetChange(change, netChanges))
    return changes.length ? [{ ...entry, changes }] : []
  })
}

function rebaseProvenanceAfterFailedSave(entries: ProvenanceEntry[], draft: DraftDocument): ProvenanceEntry[] {
  const rebased = entries.map((entry) => ({ ...entry, changes: [...entry.changes] }))
  for (let entryIndex = 0; entryIndex < rebased.length; entryIndex += 1) {
    const entry = rebased[entryIndex]!
    const priorChanges = rebased.slice(0, entryIndex).flatMap((prior) => prior.changes)
    const keptChanges = entry.changes.filter((change) => {
      const cancelled = cancelledPriorScalarChanges(change, change.before, priorChanges)
      if (!cancelled.length) return true
      for (const prior of cancelled) {
        for (const previous of rebased.slice(0, entryIndex)) previous.changes = previous.changes.filter((candidate) => candidate !== prior)
      }
      return false
    })
    entry.changes = keptChanges
  }
  return rebased.flatMap((entry) => {
    const reconciled = reconcileProvenance([entry], draft)[0]
    return reconciled ? [reconciled] : []
  })
}

function normalizeDocument(document: DraftDocument, legacyVisibility = false): DraftDocument {
  const layout = normalizeLayout(document.layout, legacyVisibility ? document.cv.activeSections : undefined)
  return { layout, cv: synchronizeCVActiveSections(document.cv, layout) }
}

function documentsEqual(left: DraftDocument | null, right: DraftDocument | null): boolean {
  if (left === right) return true
  if (!left || !right) return false
  return deepEqual(left, right)
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => deepEqual(value, right[index]))
  }

  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord)
  const rightKeys = Object.keys(rightRecord)
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.prototype.hasOwnProperty.call(rightRecord, key) && deepEqual(leftRecord[key], rightRecord[key]))
}

export function useCVStore(id: string) {
  const { t } = useLocale()
  const [documents, setDocuments] = useState<DocumentState>(emptyDocuments)
  const documentsRef = useRef(documents)
  const [profileId, setProfileId] = useState<string>()
  const [status, setStatus] = useState<CVStoreStatus>('loading')
  const [error, setError] = useState<string | undefined>()
  const [savePending, setSavePending] = useState(false)
  const [baseRevision, setBaseRevision] = useState(0)
  const [pendingAIProvenance, setPendingAIProvenance] = useState<ProvenanceEntry[]>([])
  const provenanceRef = useRef<ProvenanceEntry[]>([])
  const provenanceIDRef = useRef(0)
  const inFlightProvenanceIDsRef = useRef(new Set<number>())
  const documentVersionRef = useRef(0)
  const pendingSaveRef = useRef<Promise<void> | undefined>(undefined)

  const replaceDocuments = useCallback((next: DocumentState) => {
    documentsRef.current = next
    setDocuments(next)
  }, [])

  const reload = useCallback(async () => {
    const pendingSave = pendingSaveRef.current
    if (pendingSave) await pendingSave.catch(() => undefined)
    documentVersionRef.current += 1
    setStatus('loading')
    setError(undefined)
    try {
      const envelope = await getCV(id)
      const loaded = normalizeDocument({
        cv: envelope.profileSnapshot as CV,
        layout: envelope.layout as CVLayout,
      }, true)
      const committed = cloneDocument(loaded)
      replaceDocuments({ committed, draft: cloneDocument(committed) })
      setProfileId(envelope.profileId)
      setBaseRevision(envelope.revisionNumber ?? 0)
      provenanceRef.current = []
      inFlightProvenanceIDsRef.current.clear()
      setPendingAIProvenance([])
      setStatus('ready')
    } catch (err) {
      setStatus('error')
      setError(err instanceof ApiError ? err.message : t('storeLoadFailed'))
    }
  }, [id, replaceDocuments])

  useEffect(() => {
    void reload()
  }, [reload])

  const updateDraft = useCallback((next: DraftDocument) => {
    const current = documentsRef.current
    if (!current.committed) return

    const draft = cloneDocument(normalizeDocument(next))
    documentVersionRef.current += 1
    provenanceRef.current = current.draft ? reconcileProvenance(provenanceRef.current, draft, current.draft) : []
    setPendingAIProvenance(provenanceRef.current)
    replaceDocuments({ committed: current.committed, draft })
    setError(undefined)
    setStatus(documentsEqual(current.committed, draft) ? 'ready' : 'dirty')
  }, [replaceDocuments])

  const applyAIDraft = useCallback((next: DraftDocument, summary: string) => {
    const current = documentsRef.current
    if (!current.committed) return
    const draft = cloneDocument(normalizeDocument(next))
    if (documentsEqual(current.draft, draft)) return
    documentVersionRef.current += 1
    const changes = current.draft ? collectChanges(current.draft, draft) : []
    const netChanges = collectChanges(current.committed, draft)
    const priorAIEntries = provenanceRef.current.map((entry) => ({ entry, changes: entry.changes }))
    provenanceRef.current = reconcileProvenance(provenanceRef.current, draft)
    const cancelledPriorChanges = new Set<ProvenanceChange>()
    const survivingChanges = changes.filter((change) => {
      if (!changeMatchesNetChange(change, netChanges) && !pendingSaveRef.current) return false
      const immediateBefore = current.draft ? valueAtPath(current.draft, change.path).value : undefined
      const priorChanges = priorAIEntries
        .filter(({ entry }) => !inFlightProvenanceIDsRef.current.has(entry.id))
        .flatMap(({ changes: entryChanges }) => entryChanges)
      const cancelled = cancelledPriorScalarChanges(change, immediateBefore, priorChanges)
      cancelled.forEach((prior) => cancelledPriorChanges.add(prior))
      return cancelled.length === 0
    })
    if (cancelledPriorChanges.size) {
      provenanceRef.current = provenanceRef.current.map((entry) => ({
        ...entry,
        changes: entry.changes.filter((change) => !cancelledPriorChanges.has(change)),
      })).filter((entry) => entry.changes.length > 0)
    }
    if (survivingChanges.length) provenanceRef.current = [...provenanceRef.current, { id: ++provenanceIDRef.current, summary, changes: survivingChanges }]
    setPendingAIProvenance(provenanceRef.current)
    replaceDocuments({ committed: current.committed, draft })
    setError(undefined)
    setStatus(documentsEqual(current.committed, draft) ? 'ready' : 'dirty')
  }, [replaceDocuments])

  const discardDraft = useCallback(() => {
    if (pendingSaveRef.current) return
    const committed = documentsRef.current.committed
    if (!committed) return
    documentVersionRef.current += 1
    replaceDocuments({ committed, draft: cloneDocument(committed) })
    provenanceRef.current = []
    setPendingAIProvenance([])
    setError(undefined)
    setStatus('ready')
  }, [replaceDocuments])

  const saveDraft = useCallback((): Promise<void> => {
    if (pendingSaveRef.current) return pendingSaveRef.current
    const snapshot = documentsRef.current.draft
    if (!snapshot || documentsEqual(documentsRef.current.committed, snapshot)) return Promise.resolve()

    const saveVersion = documentVersionRef.current
    const savedProvenance = [...provenanceRef.current]
    inFlightProvenanceIDsRef.current = new Set(savedProvenance.map((entry) => entry.id))
    const source = savedProvenance.length ? 'ai' : 'user'
    const message = savedProvenance.length ? savedProvenance.map((entry) => entry.summary).join('\n') : undefined
    const savedIDs = new Set(savedProvenance.map((entry) => entry.id))
    const saveBaseRevision = baseRevision
    setSavePending(true)
    setStatus('saving')
    setError(undefined)

    const pending = (async () => {
      try {
        const result = await commitCV(id, snapshot.cv, snapshot.layout, source, message, saveBaseRevision)
        const committed = cloneDocument({
          cv: result.cv.profileSnapshot as CV,
          layout: result.cv.layout as CVLayout,
        })
        const current = documentsRef.current
        const draft = documentVersionRef.current === saveVersion
          ? cloneDocument(committed)
          : current.draft
        replaceDocuments({ committed, draft })
        setBaseRevision(result.revision?.number ?? result.cv.revisionNumber ?? saveBaseRevision + 1)
        const newerProvenance = provenanceRef.current.filter((entry) => !savedIDs.has(entry.id))
        provenanceRef.current = draft ? rebaseProvenanceAfterSuccessfulSave(newerProvenance, committed, draft) : []
        for (const savedID of savedIDs) inFlightProvenanceIDsRef.current.delete(savedID)
        setPendingAIProvenance(provenanceRef.current)
        setStatus(documentsEqual(committed, draft) ? 'saved' : 'dirty')
      } catch (err) {
        const currentDraft = documentsRef.current.draft
        if (currentDraft) {
          if (documentsEqual(documentsRef.current.committed, currentDraft)) {
            provenanceRef.current = []
          } else {
            const entriesToRebase = [...savedProvenance, ...provenanceRef.current.filter((entry) => !savedIDs.has(entry.id))]
            provenanceRef.current = rebaseProvenanceAfterFailedSave(entriesToRebase, currentDraft)
          }
          setPendingAIProvenance(provenanceRef.current)
        }
        setStatus(documentVersionRef.current === saveVersion ? 'error' : 'dirty')
        setError(err instanceof ApiError ? err.message : t('storeSaveFailed'))
        throw err
      } finally {
        for (const savedEntry of savedProvenance) inFlightProvenanceIDsRef.current.delete(savedEntry.id)
        if (pendingSaveRef.current === pending) pendingSaveRef.current = undefined
        setSavePending(false)
      }
    })()
    pendingSaveRef.current = pending
    return pending
  }, [baseRevision, id, replaceDocuments])

  const restoreRevision = useCallback((revisionId: string): Promise<void> => {
    if (pendingSaveRef.current) return Promise.reject(new ApiError(409, t('restoreBlockedSaving')))
    if (!documentsEqual(documentsRef.current.committed, documentsRef.current.draft)) return Promise.reject(new ApiError(409, t('restoreBlockedDirty')))
    setSavePending(true)
    setStatus('saving')
    setError(undefined)

    const pending = (async () => {
      try {
        const result = await restoreCVRevision(id, revisionId, baseRevision)
        const restored = cloneDocument({
          cv: result.cv.profileSnapshot as CV,
          layout: result.cv.layout as CVLayout,
        })
        documentVersionRef.current += 1
        replaceDocuments({ committed: restored, draft: cloneDocument(restored) })
        setBaseRevision(result.revision?.number ?? result.cv.revisionNumber ?? baseRevision + 1)
        provenanceRef.current = []
        setPendingAIProvenance([])
        setStatus('saved')
      } catch (err) {
        const current = documentsRef.current
        setStatus(documentsEqual(current.committed, current.draft) ? 'ready' : 'dirty')
        setError(err instanceof ApiError ? err.message : t('storeRestoreFailed'))
        throw err
      } finally {
        if (pendingSaveRef.current === pending) pendingSaveRef.current = undefined
        setSavePending(false)
      }
    })()
    pendingSaveRef.current = pending
    return pending
  }, [baseRevision, id, replaceDocuments])

  const dirty = !documentsEqual(documents.committed, documents.draft)

  return {
    committed: documents.committed,
    draft: documents.draft,
    dirty,
    saving: savePending,
    status,
    error,
    profileId,
    baseRevision,
    pendingAIProvenance: pendingAIProvenance.map((entry) => entry.summary),
    draftVersion: documentVersionRef.current,
    getDraft: () => documentsRef.current.draft,
    updateDraft,
    applyAIDraft,
    saveDraft,
    restoreRevision,
    discardDraft,
    reload,
    // Compatibility for existing preview and assistant consumers while Task 3
    // moves editor callers to draft explicitly.
    cv: documents.draft?.cv ?? null,
  }
}
