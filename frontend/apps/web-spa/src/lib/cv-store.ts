import { useCallback, useEffect, useRef, useState } from 'react'
import type { CV, CVLayout } from '../types'
import { ApiError, commitCV, getCV } from './api'

export type CVStoreStatus = 'loading' | 'ready' | 'dirty' | 'saving' | 'saved' | 'error'

export interface DraftDocument {
  cv: CV
  layout: CVLayout
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

  const replaceDocuments = useCallback((next: DocumentState) => {
    documentsRef.current = next
    setDocuments(next)
  }, [])

  const reload = useCallback(async () => {
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
    replaceDocuments({ committed: current.committed, draft })
    setError(undefined)
    setStatus(documentsEqual(current.committed, draft) ? 'ready' : 'dirty')
  }, [replaceDocuments])

  const discardDraft = useCallback(() => {
    const committed = documentsRef.current.committed
    if (!committed) return
    replaceDocuments({ committed, draft: cloneDocument(committed) })
    setError(undefined)
    setStatus('ready')
  }, [replaceDocuments])

  const saveDraft = useCallback(async (source: 'user' | 'ai' = 'user', message?: string) => {
    const snapshot = documentsRef.current.draft
    if (!snapshot || documentsEqual(documentsRef.current.committed, snapshot)) return

    setStatus('saving')
    setError(undefined)
    try {
      const result = await commitCV(id, snapshot.cv, snapshot.layout, source, message)
      const committed = cloneDocument({
        cv: result.cv.profileSnapshot as CV,
        layout: result.cv.layout as CVLayout,
      })
      const current = documentsRef.current
      const draft = documentsEqual(current.draft, snapshot) ? cloneDocument(committed) : current.draft
      replaceDocuments({ committed, draft })
      setStatus(documentsEqual(committed, draft) ? 'saved' : 'dirty')
    } catch (err) {
      setStatus('error')
      setError(err instanceof ApiError ? err.message : 'Không lưu được CV')
      throw err
    }
  }, [id, replaceDocuments])

  const dirty = !documentsEqual(documents.committed, documents.draft)

  return {
    committed: documents.committed,
    draft: documents.draft,
    dirty,
    status,
    error,
    profileId,
    updateDraft,
    saveDraft,
    discardDraft,
    reload,
    // Compatibility for existing preview and assistant consumers while Task 3
    // moves editor callers to draft explicitly.
    cv: documents.draft?.cv ?? null,
  }
}
