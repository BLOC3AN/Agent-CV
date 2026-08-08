'use client'

import { useState } from 'react'

/**
 * Xoá tài khoản — UC-13, BR-13.1.
 *
 * Bắt gõ lại email (UC-13 bước 3) và liệt kê rõ những gì sẽ mất. Thao tác này
 * không khôi phục được, nên một cú bấm nhầm không được phép đủ để thực hiện nó.
 */
export function DeleteAccount({ email }: { email: string }) {
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const remove = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmEmail: confirm }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      window.location.href = '/'
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <section className="mt-10 rounded-xl border border-danger p-4 ">
      <h2 className="font-medium text-danger ">Xoá tài khoản</h2>

      {!open ? (
        <>
          <p className="mt-1 text-sm text-ink-muted ">
            Xoá vĩnh viễn tài khoản và toàn bộ dữ liệu. Không khôi phục được.
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mt-3 rounded-lg border border-danger px-4 py-2 text-sm text-danger "
          >
            Tôi muốn xoá tài khoản
          </button>
        </>
      ) : (
        <>
          {/* Nói RÕ cái sẽ mất — UC-13 bước 2 */}
          <p className="mt-1 text-sm">Những thứ sau sẽ bị xoá và không lấy lại được:</p>
          <ul className="mt-2 list-inside list-disc text-sm text-ink-muted ">
            <li>Hồ sơ và toàn bộ lịch sử chỉnh sửa</li>
            <li>Các bản CV và file PDF đã xuất</li>
            <li>Tin tuyển dụng đã lưu và kết quả đối chiếu</li>
            <li>Toàn bộ hội thoại với trợ lý</li>
            <li>File CV gốc bạn đã tải lên</li>
          </ul>

          <label className="mt-4 block text-sm">
            Gõ <strong>{email}</strong> để xác nhận:
            <input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              aria-label="Xác nhận email"
              className="mt-1 w-full rounded border border-border-strong px-3 py-2 text-sm  "
            />
          </label>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy || confirm.trim().toLowerCase() !== email.toLowerCase()}
              className="rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {busy ? 'Đang xoá…' : 'Xoá vĩnh viễn'}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={busy}
              className="rounded-lg border border-border-strong px-4 py-2 text-sm "
            >
              Huỷ
            </button>
          </div>
          {error && (
            <p role="alert" className="mt-2 text-sm text-danger ">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  )
}
