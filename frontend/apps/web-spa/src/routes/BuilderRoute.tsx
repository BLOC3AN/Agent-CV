import React from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../lib/api'
import { useCVStore } from '../lib/cv-store'
import { CVEditorView } from '../components/CVEditorView'

export function BuilderRoute() {
  const { cvId } = useParams<{ cvId: string }>()
  const navigate = useNavigate()
  const store = useCVStore(cvId ?? '')

  if (!cvId) return <div className="p-10 text-center text-sm text-rose-600">Mã CV không hợp lệ</div>
  if (store.status === 'loading') return <div data-testid="builder-loading" className="p-10 text-center text-sm text-slate-500">Đang tải CV…</div>
  if (!store.cv) {
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
        {store.status === 'saving' && <span className="text-amber-600">Đang lưu…</span>}
        {store.status === 'saved' && <span className="text-emerald-600">Đã lưu</span>}
        {store.status === 'error' && <span className="text-rose-600">{store.error ?? 'Lưu thất bại'}</span>}
      </div>
      <CVEditorView
        cv={store.cv}
        onUpdateCV={store.update}
        onOpenPreview={() => navigate(`/builder/${cvId}/preview`)}
        onOpenShare={() => {}}
        onDownloadPDF={() => { window.location.assign(`/api/cv/${encodeURIComponent(cvId)}/export?variant=presentation`) }}
      />
    </>
  )
}
