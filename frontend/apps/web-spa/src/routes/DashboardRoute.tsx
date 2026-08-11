import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, getCV, listCVs, type CVSummary } from '../lib/api'
import { useSession } from '../lib/session'
import { DashboardView } from '../components/DashboardView'
import { errorText } from '../lib/error-messages'
import { useLocale } from '../lib/i18n'
import type { CV } from '../types'

export function DashboardRoute() {
  const navigate = useNavigate()
  const { email } = useSession()
  const { t } = useLocale()
  const [items, setItems] = useState<CVSummary[] | null>(null)
  const [active, setActive] = useState<CV | null>(null)
  const [error, setError] = useState<string>()

  const load = useCallback(async () => {
    setError(undefined)
    try {
      const next = await listCVs()
      setItems(next)
      if (next[0]) {
        const envelope = await getCV(next[0].id)
        // `profileSnapshot.id` là profile_id; các route builder/export cần
        // `cv_documents.id` (next[0].id). Giữ hai định danh tách biệt để nút
        // "Sửa CV ngay" không gọi nhầm GET /api/cv/:profileId.
        setActive({ ...(envelope.profileSnapshot as unknown as CV), id: next[0].id })
      } else {
        setActive(null)
      }
    } catch (err) {
      setError(errorText(err, t, t('dashboardLoadFailed')))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  if (error) {
    return <div className="p-10 text-center text-sm text-rose-600">{error}</div>
  }
  if (items === null) {
    return <div data-testid="dashboard-loading" className="p-10 text-center text-sm text-slate-500">{t('loadingDashboard')}</div>
  }

  return (
    <div data-testid="view-dashboard">
      <DashboardView
        cvs={active ? [active] : []}
        cvCount={items.length}
        userEmail={email}
        onOpenUploadModal={() => navigate('/import')}
      />
    </div>
  )
}
