import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useBeforeUnload, useBlocker, useParams } from 'react-router-dom'
import { useCVStore } from '../lib/cv-store'
import { applyChatOpsToDraft } from '../lib/cv-patch'
import { CVEditorView } from '../components/CVEditorView'
import { ChatPanel } from '../components/ChatPanel'
import { PreviewModal } from '../components/PreviewModal'
import { downloadCVPDF } from '../lib/download-pdf'
import { errorText } from '../lib/error-messages'
import { useBuilderLocale, useLocale, type Locale } from '../lib/i18n'
import { cvLocale } from '../lib/cv-section-titles'

export function BuilderRoute() {
  const { cvId } = useParams<{ cvId: string }>()
  const store = useCVStore(cvId ?? '')
  const builderLocale = useBuilderLocale()
  const { t } = useLocale()
  const [assistantOpen, setAssistantOpen] = useState(true)
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false)
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [exportError, setExportError] = useState<string | undefined>()
  const blocker = useBlocker(store.dirty)
  const dirtyRef = useRef(store.dirty)
  const savingRef = useRef(store.saving)
  const storeRef = useRef(store)

  useEffect(() => {
    dirtyRef.current = store.dirty
    savingRef.current = store.saving
    storeRef.current = store
  }, [store.dirty, store.saving, store])

  const save = useCallback(async () => {
    await store.saveDraft()
  }, [store.saveDraft])

  const updateManualCV = useCallback((cv: Parameters<typeof store.updateDraft>[0]['cv']) => {
    store.updateDraft({ cv, layout: store.draft!.layout })
  }, [store.updateDraft, store.draft])

  const updateManualLayout = useCallback((layout: Parameters<typeof store.updateDraft>[0]['layout']) => {
    store.updateDraft({ cv: store.draft!.cv, layout })
  }, [store.updateDraft, store.draft])

  const discardDraft = useCallback(() => {
    store.discardDraft()
  }, [store.discardDraft])

  const restoreVersion = useCallback(async (revisionId: string) => {
    await store.restoreRevision(revisionId)
  }, [store.restoreRevision])

  // Máy chủ dựng PDF rồi giao thẳng file về máy. Hai cách trước đều KHÔNG tạo
  // ra file: điều hướng sang `/print/:cvId` chỉ mở một trang HTML, còn
  // `window.print()` chỉ mở hộp thoại in — và bị nuốt lặng lẽ trong tài liệu
  // bị sandbox.
  //
  // Vì máy chủ đọc CV từ backend nên nó chỉ thấy được bản ĐÃ LƯU. Đó là lý do
  // hộp thoại bên dưới bắt chọn rõ phiên bản khi bản nháp còn thay đổi.
  const exportPDF = useCallback(async () => {
    setExportError(undefined)
    try {
      await downloadCVPDF(cvId)
    } catch (error) {
      setExportError(errorText(error, t, t('downloadFailed')))
    }
  }, [cvId])

  const downloadPDF = useCallback(() => {
    if (store.dirty) { setDownloadDialogOpen(true); return }
    void exportPDF()
  }, [exportPDF, store.dirty])

  useEffect(() => {
    const onHeaderDownload = () => downloadPDF()
    window.addEventListener('hr-agent:download-pdf', onHeaderDownload)
    return () => window.removeEventListener('hr-agent:download-pdf', onHeaderDownload)
  }, [downloadPDF])

  // `AppLayout` dựng `Header` mà không biết gì về CV, nên hai nút của trình sửa
  // đi qua cùng một cầu nối sự kiện. Xem trước mở NGAY TẠI CHỖ chứ không điều
  // hướng: rời route sẽ vướng `useBlocker` khi có thay đổi chưa lưu, và màn
  // hình preview lại nạp lại CV từ máy chủ — popup sẽ hiện bản đã lưu thay vì
  // bản nháp đang nhìn thấy. Dùng chung `store.draft` là điều kiện để bản render
  // trong trình sửa và trong popup luôn giống hệt nhau.

  // Bộ chọn ngôn ngữ nằm trong `Header`, mà `Header` dựng TRÊN route này nên
  // không đọc được CV. Đăng ký ngôn ngữ hiện tại cùng hàm đổi để nó dùng; gỡ
  // đăng ký khi rời đi để bộ chọn biến mất ở màn hình khác.
  //
  // `setLanguage` phải GIỮ NGUYÊN danh tính giữa các lần render. `useCVStore`
  // dựng lại `getDraft`/`updateDraft` mỗi lần render, nên đặt chúng vào mảng
  // phụ thuộc sẽ khiến effect đăng ký lại liên tục — provider `setState`, kéo
  // theo một lần render nữa, và vòng lặp không bao giờ dừng.
  const language = cvLocale(store.draft?.cv.language)
  const setLanguage = useCallback((next: Locale) => {
    const current = storeRef.current.getDraft()
    if (!current) return
    storeRef.current.updateDraft({ cv: { ...current.cv, language: next }, layout: current.layout })
  }, [])

  useEffect(() => {
    if (!store.draft) return
    builderLocale.register(language, setLanguage)
    return () => builderLocale.unregister()
  }, [builderLocale.register, builderLocale.unregister, language, setLanguage, Boolean(store.draft)])

  useEffect(() => {
    const onHeaderPreview = () => setPreviewOpen(true)
    window.addEventListener('hr-agent:open-preview', onHeaderPreview)
    return () => window.removeEventListener('hr-agent:open-preview', onHeaderPreview)
  }, [])

  const saveAndDownload = async () => {
    await save()
    setDownloadDialogOpen(false)
    await exportPDF()
  }

  const discardAndDownload = async () => {
    discardDraft()
    setDownloadDialogOpen(false)
    await exportPDF()
  }

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

  if (!cvId) return <div className="p-10 text-center text-sm text-rose-600">{t('invalidCVId')}</div>
  if (store.status === 'loading') return <div data-testid="builder-loading" className="p-10 text-center text-sm text-slate-500">{t('loadingCV')}</div>
  if (!store.draft) {
    return (
      <div className="p-10 text-center space-y-3">
        <p className="text-sm font-semibold text-rose-600">{store.error ?? t('cvNotFound')}</p>
        <button onClick={() => void store.reload()} className="px-4 py-2 rounded-xl bg-slate-100 text-xs font-semibold">{t('retry')}</button>
      </div>
    )
  }

  return (
    <>
      <div className="fixed top-[88px] right-4 z-40 text-xs font-medium" aria-live="polite">
        {store.status === 'dirty' && <span className="text-amber-600">{t('statusDirty')}</span>}
        {store.status === 'saving' && <span className="text-amber-600">{t('statusSaving')}</span>}
        {store.status === 'saved' && <span className="text-emerald-600">{t('statusSaved')}</span>}
        {store.status === 'error' && <span className="text-rose-600">{store.error ?? t('statusSaveFailed')}</span>}
      </div>
      {exportError && (
        <div role="alert" className="fixed top-[120px] right-4 z-40 max-w-xs rounded-xl bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 shadow-sm">
          {exportError}
        </div>
      )}
      <CVEditorView
        cv={store.draft.cv}
        layout={store.draft.layout}
        onUpdateCV={updateManualCV}
        onUpdateLayout={updateManualLayout}
        onSave={() => void save().catch(() => undefined)}
        onDiscard={discardDraft}
        dirty={store.dirty}
        saving={store.status === 'saving'}
        cvId={cvId}
        onRestoreVersion={restoreVersion}
      />
      {store.profileId && assistantOpen && <div className="fixed bottom-4 right-4 z-50 h-[min(720px,calc(100vh-2rem))] w-[min(380px,calc(100vw-2rem))]"><ChatPanel profileId={store.profileId} cvId={cvId} cv={store.draft.cv} layout={store.draft.layout} draftVersion={store.draftVersion} onApplyAIProposal={(ops, summary) => { const current = store.getDraft(); if (!current) throw new Error(t('noCurrentDraft')); store.applyAIDraft(applyChatOpsToDraft(current, ops), summary) }} onClose={() => setAssistantOpen(false)} /></div>}
      {store.profileId && !assistantOpen && <button type="button" onClick={() => setAssistantOpen(true)} className="fixed bottom-4 right-4 z-50 rounded-2xl bg-violet-600 px-4 py-3 text-xs font-semibold text-white shadow-xl hover:bg-violet-700">{t('openAssistant')}</button>}
      {previewOpen && (
        <PreviewModal
          isOpen
          cv={store.draft.cv}
          layout={store.draft.layout}
          onClose={() => setPreviewOpen(false)}
          onDownloadPDF={downloadPDF}
        />
      )}
      {leaveDialogOpen && blocker.state === 'blocked' && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/35 p-4">
          <div role="dialog" aria-modal="true" aria-label={t('unsavedTitle')} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-base font-bold text-slate-900">{t('unsavedTitle')}</h2>
            <p className="mt-2 text-sm text-slate-600">{t('unsavedBody')}</p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={cancelLeave} className="rounded-xl px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100">{t('cancel')}</button>
              <button type="button" onClick={discardAndLeave} disabled={store.saving} className="rounded-xl border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50">{t('discard')}</button>
              <button type="button" onClick={() => void saveAndLeave()} className="rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700">{t('saveAndLeave')}</button>
            </div>
          </div>
        </div>
      )}
      {downloadDialogOpen && (
        <div className="fixed inset-0 z-[65] flex items-center justify-center bg-slate-950/35 p-4">
          <div role="dialog" aria-modal="true" aria-label={t('downloadDialogLabel')} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-base font-bold text-slate-900">{t('downloadDialogTitle')}</h2>
            <p className="mt-2 text-sm text-slate-600">{t('downloadDialogBody')}</p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setDownloadDialogOpen(false)} className="rounded-xl px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100">{t('cancel')}</button>
              <button type="button" onClick={discardAndDownload} disabled={store.saving} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50">{t('discardAndDownload')}</button>
              <button type="button" onClick={() => void saveAndDownload().catch(() => undefined)} disabled={store.saving} className="rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{t('saveAndDownload')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
