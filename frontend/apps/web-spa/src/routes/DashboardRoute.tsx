import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, getCV, listCVs, type CVSummary } from '../lib/api'
import { useSession } from '../lib/session'
import { DashboardView } from '../components/DashboardView'
import type { CV } from '../types'

export function DashboardRoute() {
  const navigate = useNavigate()
  const { email } = useSession()
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
        setActive(envelope.profileSnapshot as unknown as CV)
      } else {
        setActive(null)
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không tải được trang tổng quan')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  if (error) {
    return <div className="p-10 text-center text-sm text-rose-600">{error}</div>
  }
  if (items === null) {
    return <div data-testid="dashboard-loading" className="p-10 text-center text-sm text-slate-500">Đang tải tổng quan…</div>
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
