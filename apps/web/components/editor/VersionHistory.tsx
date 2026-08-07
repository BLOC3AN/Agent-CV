'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Profile } from '@hr/schema'

/**
 * Lịch sử phiên bản — UC-34.
 *
 * Mỗi lần thông tin thay đổi là một mốc xem lại và khôi phục được. Cơ chế đã
 * chạy từ M1 (`profile_revisions` lưu cả patch lẫn patch nghịch đảo); đây là
 * phần giao diện.
 *
 * Phân biệt rõ AI sửa và người sửa: người dùng cần biết thay đổi nào là của
 * mình để tin vào lịch sử của chính họ.
 */

interface Revision {
  id: string
  author: 'user' | 'ai' | 'import'
  createdAt: string
  opCount: number
}

const AUTHOR: Record<Revision['author'], { label: string; tone: string }> = {
  user: { label: 'Bạn sửa', tone: 'text-neutral-700 dark:text-neutral-300' },
  ai: { label: 'Trợ lý sửa', tone: 'text-sky-700 dark:text-sky-400' },
  import: { label: 'Đọc từ CV', tone: 'text-neutral-500' },
}

function when(iso: string): string {
  const d = new Date(iso)
  const mins = Math.round((Date.now() - d.getTime()) / 60_000)
  if (mins < 1) return 'vừa xong'
  if (mins < 60) return `${mins} phút trước`
  if (mins < 24 * 60) return `${Math.round(mins / 60)} giờ trước`
  return d.toLocaleDateString('vi-VN')
}

export function VersionHistory({
  profileId,
  onRestored,
}: {
  profileId: string
  onRestored: (p: Profile) => void
}) {
  const [items, setItems] = useState<Revision[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/profiles/${profileId}/revisions`)
      const data = (await res.json()) as { revisions?: Revision[] }
      setItems(data.revisions ?? [])
    } catch (e) {
      setError((e as Error).message)
    }
  }, [profileId])

  useEffect(() => {
    void load()
  }, [load])

  const restore = async (revisionId: string): Promise<void> => {
    setBusy(revisionId)
    setError(null)
    try {
      const res = await fetch(`/api/profiles/${profileId}/revert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revisionId }),
      })
      const data = (await res.json()) as { profile?: Profile; error?: string }
      if (!res.ok || !data.profile) throw new Error(data.error ?? `HTTP ${res.status}`)

      onRestored(data.profile)
      // Khôi phục cũng là một thay đổi → lịch sử dài thêm một mốc
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-label="Lịch sử thay đổi">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Lịch sử thay đổi
      </h2>

      {error && (
        <p role="alert" className="mb-2 rounded border border-red-300 bg-red-50 p-2 text-sm">
          {error}
        </p>
      )}

      {items === null && <p className="text-sm text-neutral-500">Đang tải…</p>}

      {items?.length === 0 && (
        <p className="text-sm text-neutral-500">
          Chưa có thay đổi nào. Mỗi lần bạn sửa CV, một mốc sẽ hiện ở đây.
        </p>
      )}

      <ol className="space-y-2">
        {items?.map((r, i) => (
          <li
            key={r.id}
            className="rounded-lg border border-neutral-200 p-2 text-sm dark:border-neutral-700"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className={AUTHOR[r.author]?.tone}>
                {AUTHOR[r.author]?.label ?? r.author}
              </span>
              <span className="text-xs text-neutral-400">{when(r.createdAt)}</span>
            </div>
            <p className="mt-0.5 text-xs text-neutral-500">
              {r.opCount} thay đổi
              {i === 0 && ' · bản hiện tại'}
            </p>

            {/* Bản hiện tại không có gì để khôi phục về */}
            {i > 0 && (
              <button
                type="button"
                onClick={() => void restore(r.id)}
                disabled={busy !== null}
                className="mt-1.5 rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-40 dark:border-neutral-600"
              >
                {busy === r.id ? 'Đang khôi phục…' : 'Khôi phục về đây'}
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}
