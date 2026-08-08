'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'

/**
 * `/login` — UC-11.
 *
 * Chỉ có magic link ở giai đoạn này. Google OAuth cần đăng ký ứng dụng và khoá
 * bí mật; thêm một nút không bấm được vào đây còn tệ hơn không có nút (BR-01.3).
 */
/**
 * `useSearchParams` buộc phải nằm trong `<Suspense>`: không có nó thì Next
 * không dựng sẵn được trang và cả bản build hỏng — lỗi chỉ lộ ra lúc build
 * production, không lộ ở `next dev`.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const err = useSearchParams().get('error')
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [devLink, setDevLink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setState('sending')
    setError(null)
    try {
      const res = await fetch('/api/auth/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = (await res.json()) as { error?: string; devLink?: string }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setDevLink(data.devLink ?? null)
      setState('sent')
    } catch (e) {
      setError((e as Error).message)
      setState('idle')
    }
  }

  return (
    <main className="mx-auto max-w-md px-6 py-20">
      <h1 className="text-2xl font-semibold">Đăng nhập</h1>
      <p className="mt-2 text-sm text-ink-muted ">
        Nhập email, chúng tôi gửi cho bạn một link đăng nhập. Không cần mật khẩu.
      </p>

      {err && (
        <p role="alert" className="mt-4 rounded border border-warn bg-warn-subtle p-3 text-sm ">
          {err}
        </p>
      )}

      {state === 'sent' ? (
        <div className="mt-6 rounded-lg border border-border p-4 ">
          <p className="text-sm">
            Đã tạo link đăng nhập cho <strong>{email}</strong>. Link hết hạn sau 15 phút.
          </p>
          {/*
            Chưa cấu hình SMTP thì NÓI THẲNG và đưa link ra, thay vì để người
            dùng ngồi chờ một email không bao giờ tới. Nhánh này tắt khi đặt
            SMTP_URL (xem lib/mailer.ts).
          */}
          {devLink && (
            <div className="mt-3 rounded bg-canvas p-3 text-xs ">
              <p className="font-medium">Máy này chưa cấu hình gửi email.</p>
              <a href={devLink} className="mt-1 block break-all text-brand-ink underline ">
                {devLink}
              </a>
            </div>
          )}
          <button
            type="button"
            onClick={() => setState('idle')}
            className="mt-3 text-sm text-ink-muted underline"
          >
            Dùng email khác
          </button>
        </div>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="mt-6 space-y-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ban@example.com"
            aria-label="Email"
            className="w-full rounded border border-border-strong px-3 py-2 text-sm  "
          />
          <button
            type="submit"
            disabled={state === 'sending' || !email.trim()}
            className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {state === 'sending' ? 'Đang gửi…' : 'Gửi link đăng nhập'}
          </button>
          {error && (
            <p role="alert" className="text-sm text-danger ">
              {error}
            </p>
          )}
        </form>
      )}

      <p className="mt-8 text-sm text-ink-muted">
        <Link href="/" className="underline">
          Quay lại trang chủ
        </Link>
      </p>
    </main>
  )
}
