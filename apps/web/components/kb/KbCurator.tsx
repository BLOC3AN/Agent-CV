'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Duyệt tri thức HR — UC-62.
 *
 * Việc quan trọng nhất ở đây là gán TÊN NGƯỜI CHỊU TRÁCH NHIỆM. Không có tên
 * thì nguồn không kích hoạt được, và mọi lời khuyên dựa trên nó rơi xuống nhãn
 * "gợi ý chung của AI" (§10.4).
 */

export interface KbChunkView {
  id: string
  sourceId: string
  contentType: string
  text: string
  breadcrumb: string | null
  section: string[]
  seniority: string[]
  priority: number
}

interface Source {
  id: string
  slug: string
  title: string
  authorName: string
  authorTitle: string | null
  status: string
  chunkCount: number
  canActivate: boolean
}

const TYPE_LABEL: Record<string, string> = {
  guideline: 'Hướng dẫn',
  exemplar: 'Ví dụ trước/sau',
  red_flag: 'Dấu hiệu xấu',
  clarifying_question: 'Câu hỏi làm rõ',
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Bản nháp — chưa dùng',
  pending_review: 'Chờ duyệt',
  active: 'Đang dùng',
  archived: 'Đã lưu trữ',
}

export function KbCurator({ chunks }: { chunks: KbChunkView[] }) {
  const [sources, setSources] = useState<Source[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<string, { name: string; title: string }>>({})

  const load = useCallback(async () => {
    const res = await fetch('/api/kb')
    const d = (await res.json()) as { sources: Source[] }
    setSources(d.sources)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (
    sourceId: string,
    body: Record<string, unknown>,
  ): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/kb', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId, ...body }),
      })
      const d = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`)
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const byType = chunks.reduce<Record<string, KbChunkView[]>>((acc, c) => {
    ;(acc[c.contentType] ??= []).push(c)
    return acc
  }, {})

  return (
    <div className="mt-6 space-y-8">
      {error && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm">
          {error}
        </p>
      )}

      {/* ── Nguồn ────────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Nguồn tri thức
        </h2>
        {sources === null && <p className="text-sm text-neutral-500">Đang tải…</p>}

        <ul className="space-y-3">
          {sources?.map((s) => {
            const d = draft[s.id] ?? { name: '', title: '' }
            return (
              <li
                key={s.id}
                className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-700"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-medium">{s.title}</h3>
                  <span
                    className={[
                      'rounded px-2 py-0.5 text-xs',
                      s.status === 'active'
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                        : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400',
                    ].join(' ')}
                  >
                    {STATUS_LABEL[s.status] ?? s.status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-neutral-500">
                  {s.chunkCount} đoạn · {s.slug}
                </p>

                <p className="mt-2 text-sm">
                  Người chịu trách nhiệm:{' '}
                  {s.canActivate ? (
                    <strong>
                      {s.authorName}
                      {s.authorTitle ? ` — ${s.authorTitle}` : ''}
                    </strong>
                  ) : (
                    <span className="text-amber-700 dark:text-amber-400">chưa có</span>
                  )}
                </p>

                {!s.canActivate && (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <label className="text-sm">
                      <span className="text-neutral-600 dark:text-neutral-400">Họ tên</span>
                      <input
                        value={d.name}
                        onChange={(e) =>
                          setDraft((x) => ({ ...x, [s.id]: { ...d, name: e.target.value } }))
                        }
                        placeholder="Nguyễn Thị B"
                        className="mt-1 w-full rounded border border-neutral-300 px-2 py-1.5 dark:border-neutral-600 dark:bg-neutral-800"
                      />
                    </label>
                    <label className="text-sm">
                      <span className="text-neutral-600 dark:text-neutral-400">Chức danh</span>
                      <input
                        value={d.title}
                        onChange={(e) =>
                          setDraft((x) => ({ ...x, [s.id]: { ...d, title: e.target.value } }))
                        }
                        placeholder="HR Lead, 8 năm, FPT Software"
                        className="mt-1 w-full rounded border border-neutral-300 px-2 py-1.5 dark:border-neutral-600 dark:bg-neutral-800"
                      />
                    </label>
                  </div>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  {!s.canActivate && (
                    <button
                      type="button"
                      onClick={() =>
                        void save(s.id, { authorName: d.name.trim(), authorTitle: d.title.trim() })
                      }
                      disabled={busy || d.name.trim().length < 2}
                      className="rounded border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-neutral-600"
                    >
                      Lưu người chịu trách nhiệm
                    </button>
                  )}
                  {s.status !== 'active' ? (
                    <button
                      type="button"
                      onClick={() => void save(s.id, { status: 'active' })}
                      disabled={busy || !s.canActivate}
                      title={s.canActivate ? undefined : 'Cần điền người chịu trách nhiệm trước'}
                      className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                    >
                      Kích hoạt
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void save(s.id, { status: 'archived' })}
                      disabled={busy}
                      className="rounded border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-600"
                    >
                      Ngừng dùng
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </section>

      {/* ── Nội dung ─────────────────────────────────────────────────── */}
      {Object.entries(byType).map(([type, list]) => (
        <section key={type}>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            {TYPE_LABEL[type] ?? type} ({list.length})
          </h2>
          <ul className="space-y-2">
            {list.map((c) => (
              <li
                key={c.id}
                className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-700"
              >
                <div className="flex flex-wrap items-baseline gap-2 text-xs text-neutral-500">
                  {c.breadcrumb && <code>{c.breadcrumb}</code>}
                  {c.section.length > 0 && <span>mục: {c.section.join(', ')}</span>}
                  {c.seniority.length > 0 && <span>cấp: {c.seniority.join(', ')}</span>}
                  <span>ưu tiên {c.priority}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm">{c.text}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
