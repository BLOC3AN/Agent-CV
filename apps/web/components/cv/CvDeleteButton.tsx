'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function CvDeleteButton({ cvId, title }: { cvId: string; title: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const remove = async () => {
    if (!window.confirm(`Xoá “${title}”? Thao tác này không thể hoàn tác.`)) return

    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/cv/${cvId}`, { method: 'DELETE' })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <span className="flex shrink-0 items-center gap-2">
      {error && <span role="alert" className="max-w-40 text-right text-xs text-danger">{error}</span>}
      <button
        type="button"
        onClick={() => void remove()}
        disabled={busy}
        aria-label={`Xoá ${title}`}
        className="rounded-md border border-danger px-2.5 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger-subtle disabled:opacity-50"
      >
        {busy ? 'Đang xoá…' : 'Xoá'}
      </button>
    </span>
  )
}
