import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { createPortal } from 'react-dom'
import { ApiError, getCVRevision, listCVRevisions } from '../lib/api'
import type { CVRevisionSnapshot, CVRevisionSummary } from '../lib/api'
import type { CV, CVLayout } from '../types'
import { CVBlockRenderer } from './CVBlockRenderer'

interface VersionHistoryPanelProps {
  cvId: string
  onClose: () => void
  onRestore: (revisionId: string) => Promise<void>
  returnFocusRef: RefObject<HTMLElement | null>
}

type RevisionPreview = Awaited<ReturnType<typeof getCVRevision>>

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter((element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true')
}

function sourceLabel(source: CVRevisionSummary['source']): string {
  if (source === 'ai') return 'AI'
  if (source === 'restore') return 'Khôi phục'
  return 'Người dùng'
}

function formatRevisionTime(createdAt: string): string {
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return createdAt
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date)
}

function SnapshotPreview({ title, snapshot }: { title: string; snapshot?: CVRevisionSnapshot }) {
  return (
    <section className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-700">{title}</h3>
      {snapshot ? (
        <div className="max-h-96 overflow-auto rounded-lg bg-white px-5 py-6 shadow-sm">
          <CVBlockRenderer cv={snapshot.profileSnapshot as CV} layout={snapshot.layout as CVLayout} variant="preview" />
        </div>
      ) : <p className="text-xs text-slate-500">Không có bản trước đó cho phiên bản này.</p>}
    </section>
  )
}

export function VersionHistoryPanel({ cvId, onClose, onRestore, returnFocusRef }: VersionHistoryPanelProps) {
  const [revisions, setRevisions] = useState<CVRevisionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [preview, setPreview] = useState<RevisionPreview>()
  const [selectedRevisionId, setSelectedRevisionId] = useState<string>()
  const [previewingId, setPreviewingId] = useState<string>()
  const [restoreTarget, setRestoreTarget] = useState<CVRevisionSummary>()
  const [restoring, setRestoring] = useState(false)
  const previewGenerationRef = useRef(0)
  const historyDialogRef = useRef<HTMLElement>(null)
  const confirmationDialogRef = useRef<HTMLElement>(null)
  const historyCloseRef = useRef<HTMLButtonElement>(null)
  const confirmationCancelRef = useRef<HTMLButtonElement>(null)
  const confirmationInvokerRef = useRef<HTMLElement>(null)

  useLayoutEffect(() => {
    const dialog = restoreTarget ? confirmationDialogRef.current : historyDialogRef.current
    const initialFocus = restoreTarget ? confirmationCancelRef.current : historyCloseRef.current
    if (!dialog || !initialFocus) return
    initialFocus.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (restoreTarget) {
          setRestoreTarget(undefined)
        } else {
          returnFocusRef.current?.focus()
          onClose()
        }
        return
      }
      if (event.key !== 'Tab') return
      const focusable = focusableElements(dialog)
      if (!focusable.length) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      const activeIndex = focusable.indexOf(document.activeElement as HTMLElement)
      const nextIndex = event.shiftKey
        ? activeIndex <= 0 ? focusable.length - 1 : activeIndex - 1
        : activeIndex < 0 || activeIndex === focusable.length - 1 ? 0 : activeIndex + 1
      event.preventDefault()
      focusable[nextIndex]!.focus()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [restoreTarget, onClose])

  useEffect(() => {
    if (historyDialogRef.current) historyDialogRef.current.inert = Boolean(restoreTarget)
  }, [restoreTarget])

  useEffect(() => {
    if (!restoreTarget) confirmationInvokerRef.current?.focus()
  }, [restoreTarget])

  useEffect(() => {
    let active = true
    void listCVRevisions(cvId)
      .then((items) => { if (active) setRevisions(items) })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof ApiError ? cause.message : 'Không tải được lịch sử phiên bản')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [cvId])

  const openPreview = async (revisionId: string) => {
    const generation = ++previewGenerationRef.current
    setSelectedRevisionId(revisionId)
    setPreview(undefined)
    setPreviewingId(revisionId)
    setError(undefined)
    try {
      const nextPreview = await getCVRevision(cvId, revisionId)
      if (generation === previewGenerationRef.current) setPreview(nextPreview)
    } catch (cause) {
      if (generation === previewGenerationRef.current) setError(cause instanceof ApiError ? cause.message : 'Không tải được bản xem trước')
    } finally {
      if (generation === previewGenerationRef.current) setPreviewingId(undefined)
    }
  }

  const requestRestore = (target: CVRevisionSummary, invoker: HTMLElement) => {
    confirmationInvokerRef.current = invoker
    setRestoreTarget(target)
  }

  const closeConfirmation = () => {
    setRestoreTarget(undefined)
  }

  const closeHistory = () => {
    returnFocusRef.current?.focus()
    onClose()
  }

  const restore = async () => {
    if (!restoreTarget || restoring) return
    setRestoring(true)
    setError(undefined)
    try {
      await onRestore(restoreTarget.id)
      closeHistory()
    } catch (cause) {
      setRestoreTarget(undefined)
      setError(cause instanceof ApiError ? cause.message : 'Không thể khôi phục phiên bản')
    } finally {
      setRestoring(false)
    }
  }

  const panel = (
    <>
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/35 p-4">
      <section ref={historyDialogRef} role="dialog" aria-modal="true" aria-hidden={restoreTarget ? 'true' : undefined} aria-label="Lịch sử phiên bản" className="flex max-h-[calc(100vh-2rem)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">Lịch sử phiên bản</h2>
            <p className="mt-1 text-xs text-slate-500">Xem lại thay đổi hoặc khôi phục một phiên bản đã lưu.</p>
          </div>
          <button ref={historyCloseRef} type="button" onClick={closeHistory} className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100">Đóng</button>
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-1 divide-y divide-slate-200 overflow-auto md:grid-cols-[20rem_minmax(0,1fr)] md:divide-x md:divide-y-0">
          <div className="space-y-3 p-4">
            {loading && <p className="text-sm text-slate-500">Đang tải lịch sử phiên bản…</p>}
            {!loading && !error && revisions.length === 0 && <p className="text-sm text-slate-500">Chưa có phiên bản đã lưu.</p>}
            {revisions.map((revision) => (
              <article key={revision.id} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Phiên bản {revision.number}</h3>
                    <p className="mt-1 text-xs font-medium text-indigo-700">{sourceLabel(revision.source)}</p>
                    <p className="mt-1 text-xs text-slate-500">{formatRevisionTime(revision.createdAt)}</p>
                    {revision.message && <p className="mt-2 text-xs text-slate-700">{revision.message}</p>}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" aria-pressed={selectedRevisionId === revision.id} onClick={() => void openPreview(revision.id)} disabled={previewingId === revision.id || restoring} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                    {previewingId === revision.id ? 'Đang tải…' : `Xem trước phiên bản ${revision.number}`}
                  </button>
                  <button type="button" onClick={(event) => requestRestore(revision, event.currentTarget)} disabled={restoring} className="rounded-lg border border-indigo-200 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">
                    Khôi phục phiên bản {revision.number}
                  </button>
                </div>
              </article>
            ))}
          </div>
          <div className="min-h-72 p-4">
            {error && <p role="alert" className="mb-4 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
            {previewingId && <p className="text-sm text-slate-500">Đang tải bản xem trước…</p>}
            {!previewingId && preview ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <SnapshotPreview title="Trước khi thay đổi" snapshot={preview.before} />
                <SnapshotPreview title="Sau thay đổi" snapshot={preview.revision} />
              </div>
            ) : !previewingId && !error && !loading && <p className="text-sm text-slate-500">Chọn một phiên bản để xem trước thay đổi.</p>}
          </div>
        </div>
      </section>
      </div>
      {restoreTarget && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/35 p-4">
          <section ref={confirmationDialogRef} role="dialog" aria-modal="true" aria-label="Xác nhận khôi phục phiên bản" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-base font-bold text-slate-900">Khôi phục phiên bản {restoreTarget.number}?</h2>
            <p className="mt-2 text-sm text-slate-600">Thao tác này tạo một phiên bản mới và giữ lại lịch sử hiện có.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button ref={confirmationCancelRef} type="button" onClick={closeConfirmation} disabled={restoring} className="rounded-xl px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50">Hủy</button>
              <button type="button" onClick={() => void restore()} disabled={restoring} className="rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">{restoring ? 'Đang khôi phục…' : 'Tạo phiên bản khôi phục'}</button>
            </div>
          </section>
        </div>
      )}
    </>
  )

  return createPortal(panel, document.body)
}
