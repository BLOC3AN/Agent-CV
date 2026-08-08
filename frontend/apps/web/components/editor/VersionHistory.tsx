'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Profile } from '@hr/schema'
import { RevisionPreview } from './RevisionPreview'

/**
 * Lịch sử phiên bản — UC-34.
 *
 * Mỗi lần thông tin thay đổi là một mốc xem lại và khôi phục được. Cơ chế đã
 * chạy từ M1 (`profile_revisions` lưu cả patch lẫn patch nghịch đảo); đây là
 * phần giao diện.
 *
 * Phân biệt rõ AI sửa và người sửa: người dùng cần biết thay đổi nào là của
 * mình để tin vào lịch sử của chính họ.
 *
 * XEM đi trước KHÔI PHỤC: khôi phục là thao tác phá (bỏ mọi mốc mới hơn), nên
 * không được là cách duy nhất để biết một mốc chứa gì. Bấm vào một mốc mở
 * `RevisionPreview` — bản CV của mốc đó, chỗ đổi tô sáng.
 */

interface Revision {
  id: string
  author: 'user' | 'ai' | 'import'
  createdAt: string
  opCount: number
}

const AUTHOR: Record<Revision['author'], { label: string; tone: string }> = {
  user: { label: 'Bạn sửa', tone: 'text-ink ' },
  ai: { label: 'Trợ lý sửa', tone: 'text-brand-ink ' },
  import: { label: 'Đọc từ CV', tone: 'text-ink-muted' },
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
  /** Mốc đang xem trước — null là chưa mở hộp thoại nào */
  const [previewing, setPreviewing] = useState<{ rev: Revision; isCurrent: boolean } | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/profiles/${profileId}/revisions`)
      const data = (await res.json()) as { revisions?: Revision[]; error?: string }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
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
      setPreviewing(null)
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
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
        Lịch sử thay đổi
      </h2>

      {error && (
        <p role="alert" className="mb-2 rounded border border-danger bg-danger-subtle p-2 text-sm">
          {error}
        </p>
      )}

      {items === null && <p className="text-sm text-ink-muted">Đang tải…</p>}

      {items?.length === 0 && (
        <p className="text-sm text-ink-muted">
          Chưa có thay đổi nào. Mỗi lần bạn sửa CV, một mốc sẽ hiện ở đây.
        </p>
      )}

      <ol className="space-y-2">
        {items?.map((r, i) => (
          <li
            key={r.id}
            className="rounded-lg border border-border p-2 text-sm "
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className={AUTHOR[r.author]?.tone}>
                {AUTHOR[r.author]?.label ?? r.author}
              </span>
              <span className="text-xs text-ink-subtle">{when(r.createdAt)}</span>
            </div>
            <p className="mt-0.5 text-xs text-ink-muted">
              {r.opCount} thay đổi
              {i === 0 && ' · bản hiện tại'}
            </p>

            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {/*
                "Xem lại" có ở MỌI mốc, kể cả bản hiện tại: người dùng thường
                muốn biết lượt sửa vừa rồi đã đổi gì, chứ không phải để quay lại.
              */}
              <button
                type="button"
                onClick={() => setPreviewing({ rev: r, isCurrent: i === 0 })}
                className="rounded border border-border-strong px-2 py-1 text-xs hover:bg-canvas  "
              >
                Xem lại bản này
              </button>

              {/* Bản hiện tại không có gì để khôi phục về */}
              {i > 0 && (
                <button
                  type="button"
                  onClick={() => void restore(r.id)}
                  disabled={busy !== null}
                  className="rounded border border-border-strong px-2 py-1 text-xs disabled:opacity-40 "
                >
                  {busy === r.id ? 'Đang khôi phục…' : 'Khôi phục về đây'}
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>

      {previewing && (
        <RevisionPreview
          profileId={profileId}
          revisionId={previewing.rev.id}
          when={when(previewing.rev.createdAt)}
          canRestore={!previewing.isCurrent}
          restoring={busy === previewing.rev.id}
          onClose={() => setPreviewing(null)}
          onRestore={() => restore(previewing.rev.id)}
        />
      )}
    </section>
  )
}
