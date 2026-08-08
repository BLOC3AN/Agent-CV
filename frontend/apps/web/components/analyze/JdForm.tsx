'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Ô dán JD — UC-41.
 *
 * Chỉ một ô nhập và một nút. Người dùng đang copy từ tab khác sang; mọi tuỳ
 * chọn thêm ở bước này đều là ma sát.
 */

const MIN = 50

export function JdForm({ cvId }: { cvId: string }) {
  const router = useRouter()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const tooShort = text.trim().length > 0 && text.trim().length < MIN

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cvId, jdText: text.trim(), language: 'vi' }),
      })
      const data = (await res.json()) as { cvId?: string; error?: string }
      if (!res.ok || !data.cvId) throw new Error(data.error ?? `HTTP ${res.status}`)

      // Chuyển sang CV BẢN MỚI, không phải bản gốc — mọi sửa đổi từ đây chỉ
      // động tới bản dành cho JD này (UC-33)
      router.push(`/analyze/${data.cvId}`)
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <section className="mt-6">
      <label htmlFor="jd" className="sr-only">
        Mô tả công việc
      </label>
      <textarea
        id="jd"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={14}
        placeholder="Dán mô tả công việc vào đây — cả phần yêu cầu ứng viên, càng đầy đủ càng chính xác."
        className="w-full rounded-lg border border-border-strong bg-white p-3 text-sm  "
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || text.trim().length < MIN}
          className="rounded bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy ? 'Đang phân tích…' : 'Phân tích'}
        </button>
        {tooShort && (
          <span className="text-sm text-ink-muted">
            Cần ít nhất {MIN} ký tự — dán thêm phần yêu cầu ứng viên giúp nhé.
          </span>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded border border-danger bg-danger-subtle p-3 text-sm">
          {error}
        </p>
      )}
    </section>
  )
}
