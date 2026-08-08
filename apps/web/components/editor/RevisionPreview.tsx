'use client'

import { useEffect, useState } from 'react'
import type { PatchOp, Profile } from '@hr/schema'
import {
  ALL_SECTIONS,
  FieldProvider,
  getTemplate,
  sectionTitle,
  type FieldRenderer,
  type SectionId,
} from '@hr/templates'
import { useEditor } from '@/lib/editor-store'
import { readAt } from '@/components/chat/PatchReviewModal'

/**
 * Xem lại một bản CV cũ TRƯỚC khi khôi phục — UC-34.
 *
 * Vì sao cần: danh sách lịch sử chỉ nói "Trợ lý sửa · 3 thay đổi". Muốn biết ba
 * thay đổi đó là gì, người dùng phải bấm "Khôi phục về đây" — một thao tác ghi,
 * và nó BỎ HẲN mọi mốc mới hơn. Nghĩa là cách duy nhất để xem là phá thứ đang có.
 *
 * Ở đây có cả hai thứ: liệt kê "cũ → mới" theo từng field, và bản CV đầy đủ của
 * mốc đó với chỗ thay đổi được TÔ SÁNG. Nhìn danh sách biết đã đổi gì, nhìn CV
 * biết nó ra hình gì.
 */

export interface Snapshot {
  revisionId: string
  author: 'user' | 'ai' | 'import'
  createdAt: string
  ops: PatchOp[]
  after: Profile
  before: Profile | null
  newerCount: number
}

/** Tô sáng field nằm trong tầm ảnh hưởng của patch */
function makeHighlighter(paths: string[]): FieldRenderer {
  return ({ path, children, className, as = 'span' }) => {
    // `/work/1` đổi cả một chỗ làm → mọi field bên trong nó cũng là chỗ đổi
    const hit = paths.some((p) => path === p || path.startsWith(`${p}/`))
    const Tag = as
    return (
      <Tag
        className={[
          className,
          hit ? 'rounded bg-warn-subtle/80 ring-1 ring-warn ' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {children}
      </Tag>
    )
  }
}

const AUTHOR_TEXT: Record<Snapshot['author'], string> = {
  user: 'Bạn sửa',
  ai: 'Trợ lý sửa',
  import: 'Đọc từ CV',
}

const OP_TEXT: Record<string, string> = {
  add: 'Thêm',
  replace: 'Sửa',
  remove: 'Xoá',
  move: 'Chuyển',
}

/**
 * Tên mục tiếng Việt cho một JSON Pointer, ví dụ `/work/0/highlights/1` →
 * "Kinh nghiệm". Người dùng không đọc JSON — `/work/0/...` lọt ra là một lỗi
 * kỹ thuật rò lên giao diện.
 *
 * Dùng `sectionTitle` của @hr/templates thay vì `sectionLabel` của @hr/ai:
 * @hr/ai kéo theo cả gateway và bộ đọc config, không nên có trong bundle trình
 * duyệt.
 */
function pointerSection(pointer: string): string | null {
  const top = pointer.split('/').filter(Boolean)[0]
  if (!top) return null
  if (top === 'basics') return 'Thông tin chung'
  return ALL_SECTIONS.includes(top as SectionId) ? sectionTitle(top as SectionId, 'vi') : null
}

function show(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' · ')
  }
  return value === undefined || value === null ? '' : JSON.stringify(value)
}

interface Props {
  profileId: string
  revisionId: string
  /** Nhãn thời gian đã tính ở danh sách — không tính lại để hai chỗ khớp nhau */
  when: string
  /** Mốc mới nhất là bản đang dùng — không có gì để khôi phục về */
  canRestore: boolean
  onClose: () => void
  onRestore: () => void | Promise<void>
  restoring: boolean
}

export function RevisionPreview({
  profileId,
  revisionId,
  when,
  canRestore,
  onClose,
  onRestore,
  restoring,
}: Props) {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showCv, setShowCv] = useState(true)
  /**
   * Xem CV ở phía nào của mốc.
   *
   * Phải có CẢ HAI vì "Khôi phục về đây" đưa hồ sơ về trạng thái NGAY TRƯỚC mốc
   * (huỷ mốc này và mọi mốc mới hơn — xem ProfileRepo.revertTo). Chỉ cho xem
   * phía "sau" thì người dùng duyệt một bản rồi nhận về một bản khác.
   */
  const [side, setSide] = useState<'after' | 'before'>('after')

  const templateId = useEditor((s) => s.templateId)
  const theme = useEditor((s) => s.theme)
  const layout = useEditor((s) => s.layout)

  useEffect(() => {
    let alive = true
    setSnap(null)
    setError(null)
    void (async () => {
      try {
        const res = await fetch(`/api/profiles/${profileId}/revisions/${revisionId}`)
        const data = (await res.json()) as Snapshot & { error?: string }
        if (!alive) return
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
        setSnap(data)
      } catch (e) {
        if (alive) setError((e as Error).message)
      }
    })()
    return () => {
      alive = false
    }
  }, [profileId, revisionId])

  const Template = getTemplate(templateId).component
  const changed = snap?.ops.map((o) => o.path) ?? []

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Xem lại bản cũ"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-2 sm:items-center sm:p-4"
    >
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-lg bg-white shadow-xl ">
        <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border p-4 ">
          <h2 className="text-lg font-semibold">Bản {when}</h2>
          <span className="text-sm text-ink-muted">
            {snap ? AUTHOR_TEXT[snap.author] : ''}
            {snap ? ` · ${snap.ops.length} thay đổi` : ''}
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="rounded px-2 py-1 text-sm text-ink-muted hover:bg-canvas "
          >
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {error && (
            <p role="alert" className="rounded border border-danger bg-danger-subtle p-2 text-sm ">
              {error}
            </p>
          )}
          {!snap && !error && <p className="text-sm text-ink-muted">Đang dựng lại bản này…</p>}

          {snap && (
            <>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Đã thay đổi ở bản này
              </h3>

              {snap.ops.length === 0 && (
                <p className="mt-2 text-sm text-ink-muted">Mốc này không đổi nội dung nào.</p>
              )}

              <ul className="mt-2 space-y-2">
                {snap.ops.map((op, i) => {
                  const old = snap.before ? readAt(snap.before, op.path) : ''
                  return (
                    <li
                      key={`${op.path}-${i}`}
                      className="rounded-lg border border-border p-2 text-sm "
                    >
                      <div className="text-xs text-ink-muted">
                        {OP_TEXT[op.op] ?? op.op}
                        {pointerSection(op.path) ? ` · ${pointerSection(op.path)}` : ''}
                      </div>
                      {/*
                        Giá trị CŨ gạch ngang, giá trị MỚI tô sáng — cùng cách
                        trình bày với màn duyệt đề xuất của trợ lý, để người dùng
                        chỉ phải học một lần.
                      */}
                      {old && op.op !== 'add' && (
                        <p className="mt-1 text-ink-muted line-through">{old}</p>
                      )}
                      {op.op === 'remove' ? (
                        <p className="mt-1 text-danger ">(xoá)</p>
                      ) : (
                        <p className="mt-1 rounded bg-warn-subtle px-1 ">
                          {show(op.value)}
                        </p>
                      )}
                    </li>
                  )
                })}
              </ul>

              <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4 ">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  CV toàn bản
                </h3>

                <div className="flex overflow-hidden rounded border border-border-strong text-xs ">
                  {(
                    [
                      ['after', 'Tại mốc này'],
                      ['before', 'Trước mốc này'],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSide(key)}
                      aria-pressed={side === key}
                      disabled={key === 'before' && snap.before === null}
                      className={[
                        'px-2 py-1 disabled:opacity-40',
                        side === key ? 'bg-brand text-white' : 'hover:bg-canvas ',
                      ].join(' ')}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => setShowCv((v) => !v)}
                  aria-expanded={showCv}
                  className="rounded border border-border-strong px-2 py-1 text-xs "
                >
                  {showCv ? 'Ẩn CV' : 'Hiện CV'}
                </button>

                {showCv && changed.length > 0 && (
                  <span className="text-xs text-ink-muted">
                    Chỗ <mark className="bg-warn-subtle ">tô vàng</mark> là chỗ
                    thay đổi
                  </span>
                )}
              </div>

              {side === 'before' && (
                <p className="mt-2 text-xs text-ink-muted">
                  Đây chính là bản bạn nhận được nếu bấm “Khôi phục về đây”.
                </p>
              )}

              {showCv && (
                // Thu nhỏ để một trang A4 vừa bề ngang hộp thoại. `origin-top`
                // để phần bị thu nhỏ không để lại khoảng trắng ở trên.
                <div className="mt-3 overflow-x-auto rounded border border-border bg-canvas p-3  ">
                  <div className="mx-auto w-fit origin-top scale-[0.72] sm:scale-90">
                    <FieldProvider renderer={makeHighlighter(changed)}>
                      <Template
                        profile={side === 'before' && snap.before ? snap.before : snap.after}
                        theme={theme}
                        layout={layout}
                        variant="screen"
                      />
                    </FieldProvider>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-border p-4 ">
          {canRestore && (
            <button
              type="button"
              onClick={() => void onRestore()}
              disabled={restoring || !snap}
              className="rounded bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {restoring ? 'Đang khôi phục…' : 'Khôi phục về đây'}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={restoring}
            className="rounded border border-border-strong px-4 py-2 text-sm "
          >
            Đóng
          </button>
          {/*
            Khôi phục là thao tác PHÁ và KHÔNG lùi lại được: nói trước cái sẽ
            mất, không để người dùng tự phát hiện sau khi đã bấm.
          */}
          {snap && canRestore && (
            <p className="text-xs text-warn ">
              Sẽ huỷ mốc này
              {snap.newerCount > 0 ? ` và ${snap.newerCount} mốc mới hơn` : ''}, đưa CV về trạng
              thái trước mốc này.
            </p>
          )}
        </footer>
      </div>
    </div>
  )
}
