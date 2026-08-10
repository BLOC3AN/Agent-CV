import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useBeforeUnload, useBlocker, useNavigate, useParams } from 'react-router-dom'
import { useCVStore } from '../lib/cv-store'
import { applyChatOpsToDraft } from '../lib/cv-patch'
import { CVEditorView } from '../components/CVEditorView'
import { ChatPanel } from '../components/ChatPanel'

export function BuilderRoute() {
  const { cvId } = useParams<{ cvId: string }>()
  const navigate = useNavigate()
  const store = useCVStore(cvId ?? '')
  const [assistantOpen, setAssistantOpen] = useState(true)
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false)
  const [pendingAIProvenance, setPendingAIProvenance] = useState<string[]>([])
  const blocker = useBlocker(store.dirty)
  const dirtyRef = useRef(store.dirty)
  const savingRef = useRef(store.saving)

  useEffect(() => {
    dirtyRef.current = store.dirty
    savingRef.current = store.saving
  }, [store.dirty, store.saving])

  const save = useCallback(async () => {
    const message = pendingAIProvenance.length ? pendingAIProvenance.join('\n') : undefined
    await store.saveDraft(message ? 'ai' : 'user', message)
    setPendingAIProvenance([])
  }, [pendingAIProvenance, store.saveDraft])

  const updateManualCV = useCallback((cv: Parameters<typeof store.updateDraft>[0]['cv']) => {
    setPendingAIProvenance([])
    store.updateDraft({ cv, layout: store.draft!.layout })
  }, [store.updateDraft, store.draft])

  const updateManualLayout = useCallback((layout: Parameters<typeof store.updateDraft>[0]['layout']) => {
    setPendingAIProvenance([])
    store.updateDraft({ cv: store.draft!.cv, layout })
  }, [store.updateDraft, store.draft])

  const discardDraft = useCallback(() => {
    setPendingAIProvenance([])
    store.discardDraft()
  }, [store.discardDraft])

  const downloadPDF = useCallback(async () => {
    await save()
    window.location.assign(`/print/${encodeURIComponent(cvId)}?variant=presentation`)
  }, [cvId, save])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 's' || (!event.ctrlKey && !event.metaKey)) return
      event.preventDefault()
      if (!store.saving) void save().catch(() => undefined)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [save, store.status])

  useBeforeUnload(useCallback((event) => {
    if (!store.dirty) return
    event.preventDefault()
    event.returnValue = ''
  }, [store.dirty]))

  useEffect(() => {
    if (blocker.state === 'blocked') setLeaveDialogOpen(true)
  }, [blocker.state])

  const cancelLeave = () => {
    blocker.reset?.()
    setLeaveDialogOpen(false)
  }

  const discardAndLeave = () => {
    if (store.saving) return
    discardDraft()
    blocker.proceed?.()
    setLeaveDialogOpen(false)
  }

  const saveAndLeave = async () => {
    try {
      await save()
      if (dirtyRef.current || savingRef.current) return
      blocker.proceed?.()
      setLeaveDialogOpen(false)
    } catch {
      // The store exposes the error beside the editor; keep this dialog open
      // so a failed save can never silently discard the pending navigation.
    }
  }

  if (!cvId) return <div className="p-10 text-center text-sm text-rose-600">Mã CV không hợp lệ</div>
  if (store.status === 'loading') return <div data-testid="builder-loading" className="p-10 text-center text-sm text-slate-500">Đang tải CV…</div>
  if (!store.draft) {
    return (
      <div className="p-10 text-center space-y-3">
        <p className="text-sm font-semibold text-rose-600">{store.error ?? 'Không tìm thấy CV'}</p>
        <button onClick={() => void store.reload()} className="px-4 py-2 rounded-xl bg-slate-100 text-xs font-semibold">Thử lại</button>
      </div>
    )
  }

  return (
    <>
      <div className="fixed top-[88px] right-4 z-40 text-xs font-medium" aria-live="polite">
        {store.status === 'dirty' && <span className="text-amber-600">Chưa lưu</span>}
        {store.status === 'saving' && <span className="text-amber-600">Đang lưu…</span>}
        {store.status === 'saved' && <span className="text-emerald-600">Đã lưu</span>}
        {store.status === 'error' && <span className="text-rose-600">{store.error ?? 'Lưu thất bại'}</span>}
      </div>
      <CVEditorView
        cv={store.draft.cv}
        layout={store.draft.layout}
        onUpdateCV={updateManualCV}
        onUpdateLayout={updateManualLayout}
        onSave={() => void save().catch(() => undefined)}
        onDiscard={discardDraft}
        dirty={store.dirty}
        saving={store.status === 'saving'}
        onOpenPreview={() => navigate(`/builder/${cvId}/preview`)}
        onOpenShare={() => {}}
        onDownloadPDF={downloadPDF}
      />
      {store.profileId && assistantOpen && <div className="fixed bottom-4 right-4 z-50 h-[min(720px,calc(100vh-2rem))] w-[min(380px,calc(100vw-2rem))]"><ChatPanel profileId={store.profileId} cvId={cvId} cv={store.draft.cv} layout={store.draft.layout} draftVersion={store.draftVersion} onApplyAIProposal={(ops) => { const current = store.getDraft(); if (!current) throw new Error('Không còn bản nháp hiện tại'); store.updateDraft(applyChatOpsToDraft(current, ops)) }} onProposalApplied={(summary) => setPendingAIProvenance((previous) => [...previous, summary])} onClose={() => setAssistantOpen(false)} /></div>}
      {store.profileId && !assistantOpen && <button type="button" onClick={() => setAssistantOpen(true)} className="fixed bottom-4 right-4 z-50 rounded-2xl bg-violet-600 px-4 py-3 text-xs font-semibold text-white shadow-xl hover:bg-violet-700">Mở Trợ lý AI</button>}
      {leaveDialogOpen && blocker.state === 'blocked' && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/35 p-4">
          <div role="dialog" aria-modal="true" aria-label="Thay đổi chưa lưu" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-base font-bold text-slate-900">Thay đổi chưa lưu</h2>
            <p className="mt-2 text-sm text-slate-600">Bạn muốn lưu bản nháp trước khi rời trình soạn thảo?</p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={cancelLeave} className="rounded-xl px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100">Hủy</button>
              <button type="button" onClick={discardAndLeave} disabled={store.saving} className="rounded-xl border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50">Bỏ thay đổi</button>
              <button type="button" onClick={() => void saveAndLeave()} className="rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700">Lưu và rời đi</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
