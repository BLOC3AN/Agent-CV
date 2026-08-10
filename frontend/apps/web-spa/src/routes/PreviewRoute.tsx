import { useNavigate, useParams } from 'react-router-dom'
import { PreviewModal } from '../components/PreviewModal'
import { useCVStore } from '../lib/cv-store'

export function PreviewRoute() {
  const { cvId } = useParams<{ cvId: string }>()
  const navigate = useNavigate()
  const store = useCVStore(cvId ?? '')

  if (!cvId) return <div className="p-10 text-center text-sm text-rose-600">Mã CV không hợp lệ</div>
  if (store.status === 'loading') return <div className="p-10 text-center text-sm text-slate-500">Đang tải CV…</div>
  if (!store.cv) {
    return <div className="p-10 text-center text-sm text-rose-600">{store.error ?? 'Không tìm thấy CV'}</div>
  }

  return (
    <PreviewModal
      isOpen
      cv={store.cv}
      layout={store.draft?.layout}
      onClose={() => navigate(`/builder/${encodeURIComponent(cvId)}`)}
      onDownloadPDF={() => { window.location.assign(`/api/cv/${encodeURIComponent(cvId)}/export?variant=presentation`) }}
    />
  )
}
