'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { intentQuery, type Intent } from '@/lib/intent'

/**
 * Ô tải CV lên + màn hình chờ — UC-21, FRONTEND §3.
 *
 * Parse một CV mất ~30-90 giây trên model server 4 slot. Người dùng phải thấy
 * việc gì đang diễn ra suốt thời gian đó, nếu không họ sẽ đóng tab hoặc bấm
 * lại — và bấm lại là thêm một job vào hàng đợi đang chậm.
 */

const MAX_BYTES = 12 * 1024 * 1024

type Phase = 'idle' | 'uploading' | 'working' | 'error'

interface Progress {
  pct: number
  note?: string
}

export function UploadBox({ intent = null }: { intent?: Intent | null }) {
  const router = useRouter()
  // Ý định đi kèm suốt luồng để bước rà soát biết dẫn người dùng đi đâu tiếp
  const carry = intentQuery(intent)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<{ code: string; message: string } | null>(null)
  const [progress, setProgress] = useState<Progress>({ pct: 0 })
  const [fileName, setFileName] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const upload = useCallback(async (file: File) => {
    setError(null)
    setFileName(file.name)

    // Kiểm phía client trước để báo lỗi NGAY, khỏi bắt user chờ tải xong mới
    // biết file sai. Server vẫn kiểm lại — client không đáng tin.
    if (file.size === 0) {
      setPhase('error')
      setError({ code: 'EMPTY', message: 'File rỗng. Bạn chọn file khác giúp nhé.' })
      return
    }
    if (file.size > MAX_BYTES) {
      setPhase('error')
      setError({
        code: 'TOO_BIG',
        message: `File nặng ${(file.size / 1024 / 1024).toFixed(1)}MB, vượt mức 12MB.`,
      })
      return
    }

    setPhase('uploading')
    const form = new FormData()
    form.append('file', file)
    form.append('language', 'vi')

    try {
      const res = await fetch('/api/uploads/cv', { method: 'POST', body: form })
      const data = (await res.json()) as { jobId?: string; error?: string; reused?: boolean }
      if (!res.ok || !data.jobId) {
        setPhase('error')
        setError({ code: String(res.status), message: data.error ?? 'Không tải lên được' })
        return
      }
      setJobId(data.jobId)
      setPhase('working')
    } catch (e) {
      setPhase('error')
      setError({ code: 'NETWORK', message: `Mất kết nối: ${(e as Error).message}` })
    }
  }, [])

  // Theo dõi tiến độ qua SSE. Chỉ chạy khi đã có jobId.
  useEffect(() => {
    if (!jobId || phase !== 'working') return

    const es = new EventSource(`/api/jobs/${jobId}/stream`)

    es.addEventListener('progress', (e) => {
      setProgress(JSON.parse((e as MessageEvent).data) as Progress)
    })
    es.addEventListener('done', () => {
      es.close()
      router.push(`/import/${jobId}/review${carry}`)
    })
    es.addEventListener('failed', (e) => {
      es.close()
      const d = JSON.parse((e as MessageEvent).data) as {
        error?: { code: string; message: string }
      }
      // Trang rà soát biết cách giải thích từng mã lỗi và mời hành động tiếp
      // theo (BR-71.1) — đừng dựng lại logic đó ở đây
      router.push(`/import/${jobId}/review${carry}`)
      void d
    })
    es.onerror = () => {
      // SSE tự kết nối lại; chỉ báo lỗi khi trình duyệt đã bỏ cuộc hẳn
      if (es.readyState === EventSource.CLOSED) {
        setPhase('error')
        setError({
          code: 'STREAM',
          message: 'Mất kết nối theo dõi. Việc xử lý vẫn chạy — bạn tải lại trang nhé.',
        })
      }
    }

    return () => es.close()
  }, [jobId, phase, router, carry])

  if (phase === 'working') {
    return (
      <section className="mt-8 rounded-lg border border-border p-6 ">
        <h2 className="font-medium">Đang đọc {fileName}…</h2>
        <p className="mt-1 text-sm text-ink-muted ">
          {progress.note ?? 'Đang chuẩn bị'}
        </p>

        <div
          className="mt-4 h-2 overflow-hidden rounded-full bg-canvas "
          role="progressbar"
          aria-valuenow={progress.pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-500"
            style={{ width: `${Math.max(3, progress.pct)}%` }}
          />
        </div>

        <p className="mt-4 text-sm text-ink-muted">
          Thường mất khoảng một phút. Bạn có thể đóng tab — kết quả vẫn được giữ, quay
          lại xem sau cũng được.
        </p>
      </section>
    )
  }

  return (
    <section className="mt-8">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          const f = e.dataTransfer.files[0]
          if (f) void upload(f)
        }}
        className={[
          'rounded-lg border-2 border-dashed p-10 text-center transition-colors',
          dragging
            ? 'border-brand-border bg-brand-subtle '
            : 'border-border-strong ',
        ].join(' ')}
      >
        <p className="text-ink-muted ">
          Kéo file PDF vào đây, hoặc
        </p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={phase === 'uploading'}
          className="mt-3 rounded bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {phase === 'uploading' ? 'Đang tải lên…' : 'Chọn file'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void upload(f)
          }}
        />
        <p className="mt-3 text-xs text-ink-muted">PDF, tối đa 12MB</p>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-danger bg-danger-subtle p-3 text-sm  "
        >
          <p>{error.message}</p>
          {/* Luôn có đường đi tiếp — không bao giờ là ngõ cụt (BR-71.1) */}
          <a href="/cv/new" className="mt-2 inline-block underline underline-offset-2">
            Hoặc nhập tay
          </a>
        </div>
      )}
    </section>
  )
}
