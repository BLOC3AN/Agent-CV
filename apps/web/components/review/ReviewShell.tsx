'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { destinationAfterReview, type Intent } from '@/lib/intent'
import { buildReviewItems, reviewProgress, type Profile, type ReviewItem } from '@hr/schema'
import { OriginalPane } from './OriginalPane'
import { ReviewList } from './ReviewList'

/**
 * Màn hình rà soát — UC-22, FRONTEND §4.
 *
 * Bố cục 2 cột: bản gốc | nội dung đọc được. Không có nút bỏ qua (BR-22.1);
 * nút "Tiếp" mở khoá khi mọi mục đã xác nhận, và điều kiện đó còn được kiểm
 * lại ở server (`POST /api/imports/:jobId/complete`) — nút bị làm mờ chỉ là
 * gợi ý giao diện, không phải cơ chế bảo vệ.
 */

interface Props {
  jobId: string
  /**
   * Ý định người dùng chọn ở Home — quyết định rà soát xong thì đi đâu.
   *
   * Người bấm "Tôi không biết CV mình dở ở đâu" mà xong lại bị quăng vào trình
   * soạn thì câu hỏi thật của họ không được trả lời ở bất kỳ đâu (UC-01 bước 5).
   */
  intent?: Intent | null
  profileId: string
  initialProfile: Profile
  quality: { level: string; warning: boolean; reasons: string[]; pages: number }
}

export function ReviewShell({ jobId, intent = null, profileId, initialProfile, quality }: Props) {
  const router = useRouter()
  const [profile, setProfile] = useState<Profile>(initialProfile)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [finishing, setFinishing] = useState(false)

  const items: ReviewItem[] = useMemo(() => buildReviewItems(profile), [profile])
  const [activePath, setActivePath] = useState<string | null>(items[0]?.path ?? null)

  const progress = reviewProgress(items, profile._meta.verified)

  const activeValues = useMemo(() => {
    const item = items.find((i) => i.path === activePath)
    return item ? item.fields.filter((f) => !f.empty).map((f) => f.value) : []
  }, [items, activePath])

  const confirm = useCallback(
    async (path: string) => {
      setBusy(path)
      setError(null)
      try {
        const res = await fetch(`/api/profiles/${profileId}/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paths: [path] }),
        })
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`)
        const data = (await res.json()) as { profile: Profile }
        setProfile(data.profile)

        // Tự mở mục chưa xác nhận kế tiếp — user không phải tự tìm chỗ tiếp theo
        const next = items.find(
          (i) => i.path !== path && data.profile._meta.verified[i.path] !== true,
        )
        setActivePath(next?.path ?? null)
      } catch (e) {
        setError(`Chưa lưu được xác nhận: ${(e as Error).message}`)
      } finally {
        setBusy(null)
      }
    },
    [items, profileId],
  )

  const edit = useCallback(
    async (itemPath: string, changes: { path: string; value: string }[]) => {
      setBusy(itemPath)
      setError(null)
      try {
        if (changes.length > 0) {
          const res = await fetch(`/api/profiles/${profileId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              // `replace` cho field đã có, `add` cho field còn trống — RFC 6902
              // không cho `replace` lên đường dẫn chưa tồn tại.
              ops: changes.map((c) => ({
                op: valueExists(profile, c.path) ? 'replace' : 'add',
                path: c.path,
                value: parseValue(c.path, c.value),
              })),
              author: 'user',
            }),
          })
          if (!res.ok) {
            throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`)
          }
          const data = (await res.json()) as { profile: Profile }
          setProfile(data.profile)
        }
        // Sửa xong là đã đọc rồi → xác nhận luôn cả mục (BR-24.2)
        await confirm(itemPath)
      } catch (e) {
        setError(`Chưa lưu được thay đổi: ${(e as Error).message}`)
        setBusy(null)
      }
    },
    [confirm, profile, profileId],
  )

  const finish = useCallback(async () => {
    setFinishing(true)
    setError(null)
    try {
      const res = await fetch(`/api/imports/${jobId}/complete`, { method: 'POST' })
      const data = (await res.json()) as { cvId?: string; error?: string; pending?: string[] }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      router.push(destinationAfterReview(intent, data.cvId!))
    } catch (e) {
      setError((e as Error).message)
      setFinishing(false)
    }
  }, [jobId, router, intent])

  return (
    <div className="mx-auto max-w-[1400px] p-4">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Kiểm tra lại thông tin đọc được</h1>
          <p className="text-sm text-ink-muted">
            Hệ thống đọc tự động nên có thể sai. Bạn xác nhận từng mục giúp nhé.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm tabular-nums text-ink-muted ">
            Đã xác nhận {progress.done}/{progress.total} mục
          </span>
          <button
            type="button"
            onClick={() => void finish()}
            disabled={!progress.complete || finishing}
            title={progress.complete ? undefined : 'Còn mục chưa xác nhận'}
            className="rounded bg-brand px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {finishing ? 'Đang tạo CV…' : 'Tiếp →'}
          </button>
        </div>
      </header>

      {quality.warning && (
        <div
          role="status"
          className="mb-4 rounded-lg border border-warn bg-warn-subtle p-3 text-sm  "
        >
          <strong>File này hơi khó đọc</strong> ({quality.reasons.join(', ')}). Bạn kiểm
          kỹ hơn bình thường giúp nhé — nhất là tên riêng và con số.
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-danger bg-danger-subtle p-3 text-sm  "
        >
          {error}
        </div>
      )}

      {/* 2 cột trên màn hình rộng, xếp dọc trên laptop hẹp/điện thoại.
          FRONTEND §1: máy của sinh viên VN phần lớn là 1366×768. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <OriginalPane jobId={jobId} highlightValues={activeValues} />
        <ReviewList
          items={items}
          verified={profile._meta.verified}
          activePath={activePath}
          onActivate={(p) => setActivePath((cur) => (cur === p ? null : p))}
          onConfirm={confirm}
          onEdit={edit}
          busy={busy}
        />
      </div>

      {/* Luôn phải có đường thoát — UC-22 luồng thay thế 3a */}
      <footer className="mt-6 border-t border-border pt-4 text-sm ">
        <a href="/cv/new" className="text-ink-muted underline underline-offset-2">
          Đọc sai nhiều quá, để tôi nhập tay
        </a>
      </footer>
    </div>
  )
}

/** Field đã tồn tại chưa — quyết định dùng `replace` hay `add` (RFC 6902). */
function valueExists(profile: Profile, pointer: string): boolean {
  let node: unknown = profile
  for (const raw of pointer.split('/').slice(1)) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~')
    if (node === null || typeof node !== 'object') return false
    node = (node as Record<string, unknown>)[key]
    if (node === undefined) return false
  }
  return true
}

function splitList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Chuyển giá trị ô nhập về đúng KIỂU mà ProfileSchema chờ đợi.
 *
 * Ba kiểu khác nhau cùng hiển thị dưới dạng "danh sách ngăn cách dấu phẩy":
 *   · `highlights`, `tech`  → mảng chuỗi
 *   · `/skills`             → mảng object `{ name }`
 *   · `/languages`          → mảng object `{ name, level? }`
 *
 * Ghi sai kiểu thì ProfileSchema từ chối CẢ patch, và user mất luôn phần sửa
 * đúng của các field khác trong cùng lần lưu.
 */
function parseValue(pointer: string, value: string): unknown {
  if (/\/(highlights|tech)$/.test(pointer)) return splitList(value)

  if (pointer === '/skills') return splitList(value).map((name) => ({ name }))

  if (pointer === '/languages') {
    return splitList(value).map((s) => {
      // "Tiếng Anh IELTS 7.0" → tên là phần đầu, trình độ là phần còn lại
      const m = /^(.*?)\s+((?:IELTS|TOEIC|TOEFL|HSK|JLPT|N[1-5]|[ABC][12]).*)$/i.exec(s)
      return m ? { name: m[1]!.trim(), level: m[2]!.trim() } : { name: s }
    })
  }

  return value
}
