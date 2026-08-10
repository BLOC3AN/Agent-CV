import { useCallback, useEffect, useRef, useState } from 'react'
import type { CV, CVLayout, LayoutNode } from '../types'
import { ApiError, commitCV, getCV } from './api'
import { validateCVFieldPlacement } from './cv-fields'

export type CVStoreStatus = 'loading' | 'ready' | 'dirty' | 'saving' | 'saved' | 'error'

export interface DraftDocument {
  cv: CV
  layout: CVLayout
}

export type CVFieldDraftValue = string | string[] | { start: string; end: string }

const highlightMarkers = {
  teamSize: 'Team size: ',
  techStack: 'Tech stack: ',
  contribution: 'Contribution: ',
} as const

function updateItem<T extends { id: string }>(items: T[], itemId: string | undefined, update: (item: T) => T): T[] | undefined {
  if (!itemId || !items.some((item) => item.id === itemId)) return undefined
  return items.map((item) => item.id === itemId ? update(item) : item)
}

function markedHighlight(highlights: string[], key: keyof typeof highlightMarkers): string {
  const marker = highlightMarkers[key]
  return highlights.find((highlight) => highlight.startsWith(marker))?.slice(marker.length) ?? ''
}

function replaceMarkedHighlight(highlights: string[], key: keyof typeof highlightMarkers, value: string): string[] {
  const marker = highlightMarkers[key]
  const withoutMarker = highlights.filter((highlight) => !highlight.startsWith(marker))
  return value.trim() ? [...withoutMarker, `${marker}${value.trim()}`] : withoutMarker
}

function replaceUnmarkedHighlights(highlights: string[], value: string): string[] {
  const markers = highlights.filter((highlight) => Object.values(highlightMarkers).some((marker) => highlight.startsWith(marker)))
  const unmarked = value.split('\n').map((line) => line.trim()).filter(Boolean)
  return [...unmarked, ...markers]
}

/**
 * Resolve a registered field to the existing CV shape. Marker-backed fields
 * deliberately stay in `highlights`, keeping the strict v2 schema valid while
 * retaining existing bullet content unchanged.
 */
export function getCVFieldDraftValue(draft: CV, node: LayoutNode, itemId: string | undefined, key: string): CVFieldDraftValue {
  validateCVFieldPlacement(key, node.type)
  const intro = draft.sections.intro
  if (node.type === 'header' || node.type === 'summary') {
    if (key === 'careerObjective') return intro.summary
    if (key === 'availability') return intro.title
    if (key === 'location') return intro.location
  }
  if (node.type === 'experience') {
    const item = draft.sections.experience.find((candidate) => candidate.id === itemId)
    if (!item) return ''
    if (key === 'role') return item.title
    if (key === 'company') return item.company
    if (key === 'time') return { start: item.startDate, end: item.endDate }
    if (key === 'highlights') return item.highlights.filter((highlight) => !Object.values(highlightMarkers).some((marker) => highlight.startsWith(marker))).join('\n')
    if (key === 'teamSize') return markedHighlight(item.highlights, 'teamSize')
    if (key === 'techStack') return markedHighlight(item.highlights, 'techStack').split(',').map((tag) => tag.trim()).filter(Boolean)
  }
  if (node.type === 'projects') {
    const item = draft.sections.projects.find((candidate) => candidate.id === itemId)
    if (!item) return ''
    if (key === 'name') return item.name
    if (key === 'role') return item.role
    if (key === 'time') return { start: item.startDate, end: item.endDate }
    if (key === 'highlights') return item.highlights.filter((highlight) => !Object.values(highlightMarkers).some((marker) => highlight.startsWith(marker))).join('\n')
    if (key === 'teamSize') return markedHighlight(item.highlights, 'teamSize')
    if (key === 'techStack') return markedHighlight(item.highlights, 'techStack').split(',').map((tag) => tag.trim()).filter(Boolean)
    if (key === 'contribution') return markedHighlight(item.highlights, 'contribution')
  }
  if (node.type === 'education') {
    const item = draft.sections.education.find((candidate) => candidate.id === itemId)
    if (!item) return ''
    if (key === 'school') return item.school
    if (key === 'degree') return item.degree
    if (key === 'field') return item.fieldOfStudy
    if (key === 'gpa') return item.gpa ?? ''
    if (key === 'time') return { start: item.startDate, end: item.endDate }
  }
  return ''
}

/** Apply one validated catalog field with immutable section and item updates. */
export function updateCVFieldDraft(draft: CV, node: LayoutNode, itemId: string | undefined, key: string, value: CVFieldDraftValue): CV {
  validateCVFieldPlacement(key, node.type)
  const text = typeof value === 'string' ? value : ''
  if (node.type === 'header' || node.type === 'summary') {
    const field = key === 'careerObjective' ? 'summary' : key === 'availability' ? 'title' : key === 'location' ? 'location' : undefined
    if (!field) return draft
    return { ...draft, sections: { ...draft.sections, intro: { ...draft.sections.intro, [field]: text } } }
  }
  if (node.type === 'experience') {
    const experience = updateItem(draft.sections.experience, itemId, (item) => {
      if (key === 'role') return { ...item, title: text }
      if (key === 'company') return { ...item, company: text }
      if (key === 'time' && typeof value !== 'string' && !Array.isArray(value)) return { ...item, startDate: value.start, endDate: value.end }
      if (key === 'highlights') return { ...item, highlights: replaceUnmarkedHighlights(item.highlights, text) }
      if (key === 'teamSize') return { ...item, highlights: replaceMarkedHighlight(item.highlights, 'teamSize', text) }
      if (key === 'techStack') return { ...item, highlights: replaceMarkedHighlight(item.highlights, 'techStack', Array.isArray(value) ? value.join(', ') : '') }
      return item
    })
    return experience ? { ...draft, sections: { ...draft.sections, experience } } : draft
  }
  if (node.type === 'projects') {
    const projects = updateItem(draft.sections.projects, itemId, (item) => {
      if (key === 'name') return { ...item, name: text }
      if (key === 'role') return { ...item, role: text }
      if (key === 'time' && typeof value !== 'string' && !Array.isArray(value)) return { ...item, startDate: value.start, endDate: value.end }
      if (key === 'highlights') return { ...item, highlights: replaceUnmarkedHighlights(item.highlights, text) }
      if (key === 'teamSize') return { ...item, highlights: replaceMarkedHighlight(item.highlights, 'teamSize', text) }
      if (key === 'techStack') return { ...item, highlights: replaceMarkedHighlight(item.highlights, 'techStack', Array.isArray(value) ? value.join(', ') : '') }
      if (key === 'contribution') return { ...item, highlights: replaceMarkedHighlight(item.highlights, 'contribution', text) }
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
      return item
    })
    return education ? { ...draft, sections: { ...draft.sections, education } } : draft
  }
  return draft
}

interface DocumentState {
  committed: DraftDocument | null
  draft: DraftDocument | null
}

const emptyDocuments: DocumentState = { committed: null, draft: null }

function cloneDocument(document: DraftDocument): DraftDocument {
  return JSON.parse(JSON.stringify(document)) as DraftDocument
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
  const [documents, setDocuments] = useState<DocumentState>(emptyDocuments)
  const documentsRef = useRef(documents)
  const [profileId, setProfileId] = useState<string>()
  const [status, setStatus] = useState<CVStoreStatus>('loading')
  const [error, setError] = useState<string | undefined>()
  const [savePending, setSavePending] = useState(false)
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
      const loaded: DraftDocument = {
        cv: envelope.profileSnapshot as CV,
        layout: envelope.layout as CVLayout,
      }
      const committed = cloneDocument(loaded)
      replaceDocuments({ committed, draft: cloneDocument(committed) })
      setProfileId(envelope.profileId)
      setStatus('ready')
    } catch (err) {
      setStatus('error')
      setError(err instanceof ApiError ? err.message : 'Không tải được CV')
    }
  }, [id, replaceDocuments])

  useEffect(() => {
    void reload()
  }, [reload])

  const updateDraft = useCallback((next: DraftDocument) => {
    const current = documentsRef.current
    if (!current.committed) return

    const draft = cloneDocument(next)
    documentVersionRef.current += 1
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
    setError(undefined)
    setStatus('ready')
  }, [replaceDocuments])

  const saveDraft = useCallback((source: 'user' | 'ai' = 'user', message?: string): Promise<void> => {
    if (pendingSaveRef.current) return pendingSaveRef.current
    const snapshot = documentsRef.current.draft
    if (!snapshot || documentsEqual(documentsRef.current.committed, snapshot)) return Promise.resolve()

    const saveVersion = documentVersionRef.current
    setSavePending(true)
    setStatus('saving')
    setError(undefined)

    const pending = (async () => {
      try {
        const result = await commitCV(id, snapshot.cv, snapshot.layout, source, message)
        const committed = cloneDocument({
          cv: result.cv.profileSnapshot as CV,
          layout: result.cv.layout as CVLayout,
        })
        const current = documentsRef.current
        const draft = documentVersionRef.current === saveVersion
          ? cloneDocument(committed)
          : current.draft
        replaceDocuments({ committed, draft })
        setStatus(documentsEqual(committed, draft) ? 'saved' : 'dirty')
      } catch (err) {
        setStatus(documentVersionRef.current === saveVersion ? 'error' : 'dirty')
        setError(err instanceof ApiError ? err.message : 'Không lưu được CV')
        throw err
      } finally {
        if (pendingSaveRef.current === pending) pendingSaveRef.current = undefined
        setSavePending(false)
      }
    })()
    pendingSaveRef.current = pending
    return pending
  }, [id, replaceDocuments])

  const dirty = !documentsEqual(documents.committed, documents.draft)

  return {
    committed: documents.committed,
    draft: documents.draft,
    dirty,
    saving: savePending,
    status,
    error,
    profileId,
    draftVersion: documentVersionRef.current,
    getDraft: () => documentsRef.current.draft,
    updateDraft,
    saveDraft,
    discardDraft,
    reload,
    // Compatibility for existing preview and assistant consumers while Task 3
    // moves editor callers to draft explicitly.
    cv: documents.draft?.cv ?? null,
  }
}
