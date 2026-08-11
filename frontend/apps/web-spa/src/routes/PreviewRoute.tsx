import { useCallback } from 'react'
import { useLocale } from '../lib/i18n'
import { useNavigate, useParams } from 'react-router-dom'
import { PreviewModal } from '../components/PreviewModal'
import { useCVStore } from '../lib/cv-store'
import { downloadCVPDF } from '../lib/download-pdf'

export function PreviewRoute() {
  const { t } = useLocale()
  const { cvId } = useParams<{ cvId: string }>()
  const navigate = useNavigate()
  const store = useCVStore(cvId ?? '')
  // Cùng một đường xuất PDF với trình sửa: máy chủ dựng file rồi giao về máy.
  const downloadPDF = useCallback(() => downloadCVPDF(cvId ?? ''), [cvId])

  if (!cvId) return <div className="p-10 text-center text-sm text-rose-600">{t('invalidCVId')}</div>
  if (store.status === 'loading') return <div className="p-10 text-center text-sm text-slate-500">{t('loadingCV')}</div>
  if (!store.cv) {
    return <div className="p-10 text-center text-sm text-rose-600">{store.error ?? t('cvNotFound')}</div>
  }

  return (
    <PreviewModal
      isOpen
      cv={store.cv}
      layout={store.draft?.layout}
      onClose={() => navigate(`/builder/${encodeURIComponent(cvId)}`)}
      onDownloadPDF={downloadPDF}
    />
  )
}
