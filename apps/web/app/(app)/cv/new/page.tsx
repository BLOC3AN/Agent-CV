'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * `/cv/new` — nhập tay. UC-23, X-6.
 *
 * CHỈ hỏi những gì tối thiểu để dựng được một hồ sơ, rồi vào thẳng trình soạn.
 * Một form 30 ô ở bước đầu là cách nhanh nhất để mất người dùng — phần còn lại
 * điền ngay trong trình soạn, nơi họ nhìn thấy CV thành hình.
 */
export default function NewCvPage() {
  const router = useRouter()
  const [form, setForm] = useState({ name: '', headline: '', email: '', phone: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/cv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = (await res.json()) as { cvId?: string; error?: string }
      if (!res.ok || !data.cvId) throw new Error(data.error ?? `HTTP ${res.status}`)
      router.push(`/builder/${data.cvId}`)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto max-w-md px-6 py-12">
      <h1 className="text-2xl font-semibold">Bắt đầu CV mới</h1>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
        Chỉ cần vài thông tin, phần còn lại điền ngay trong trình soạn.
      </p>

      <form onSubmit={(e) => void submit(e)} className="mt-6 space-y-4">
        <Field label="Họ và tên" required value={form.name} onChange={set('name')} />
        <Field
          label="Vị trí bạn nhắm tới"
          placeholder="Ví dụ: Backend Developer"
          value={form.headline}
          onChange={set('headline')}
        />
        <Field label="Email" type="email" value={form.email} onChange={set('email')} />
        <Field label="Số điện thoại" value={form.phone} onChange={set('phone')} />

        <button
          type="submit"
          disabled={busy || !form.name.trim()}
          className="w-full rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy ? 'Đang tạo…' : 'Tạo CV'}
        </button>
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </form>
    </main>
  )
}

function Field({
  label,
  required,
  ...rest
}: { label: string; required?: boolean } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block text-sm">
      {label}
      {required && <span className="text-red-600"> *</span>}
      <input
        {...rest}
        required={required}
        aria-label={label}
        className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800"
      />
    </label>
  )
}
