'use client'

import { useState } from 'react'
import type { ReviewItem, ReviewField } from '@hr/schema'

/**
 * Cột phải màn hình rà soát — UC-22 bước 3-4.
 *
 * Mỗi mục có hai hành động: "Đúng rồi" (xác nhận, không đổi giá trị) và
 * "Sửa lại" (mở ô nhập). Không có nút bỏ qua (BR-22.1).
 */

interface Props {
  items: ReviewItem[]
  verified: Record<string, boolean>
  /** Mục đang mở — quyết định vùng nào được tô sáng bên trái */
  activePath: string | null
  onActivate: (path: string) => void
  onConfirm: (path: string) => Promise<void>
  onEdit: (path: string, changes: { path: string; value: string }[]) => Promise<void>
  busy: string | null
}

export function ReviewList({
  items,
  verified,
  activePath,
  onActivate,
  onConfirm,
  onEdit,
  busy,
}: Props) {
  return (
    <section aria-label="Hệ thống đọc được" className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
        Hệ thống đọc được
      </h2>
      {items.map((item) => (
        <ReviewCard
          key={item.path}
          item={item}
          verified={verified[item.path] === true}
          open={activePath === item.path}
          onActivate={() => onActivate(item.path)}
          onConfirm={() => onConfirm(item.path)}
          onEdit={(changes) => onEdit(item.path, changes)}
          busy={busy === item.path}
        />
      ))}
    </section>
  )
}

function ReviewCard({
  item,
  verified,
  open,
  onActivate,
  onConfirm,
  onEdit,
  busy,
}: {
  item: ReviewItem
  verified: boolean
  open: boolean
  onActivate: () => void
  onConfirm: () => void
  onEdit: (changes: { path: string; value: string }[]) => Promise<void>
  busy: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})

  const startEdit = (): void => {
    setDraft(Object.fromEntries(item.fields.map((f) => [f.path, f.value])))
    setEditing(true)
    onActivate()
  }

  const save = async (): Promise<void> => {
    const changes = item.fields
      .filter((f) => (draft[f.path] ?? '') !== f.value)
      .map((f) => ({ path: f.path, value: draft[f.path] ?? '' }))
    // Không đổi gì mà bấm Lưu vẫn phải xác nhận mục — user đã đọc rồi
    await onEdit(changes)
    setEditing(false)
  }

  const hasEmpty = item.fields.some((f) => f.empty)

  return (
    <article
      className={[
        'rounded-lg border p-3 transition-colors',
        verified
          ? 'border-success bg-success-subtle  '
          : hasEmpty
            ? // BR-22.2: mục thiếu dữ liệu được làm nổi để user chú ý trước
              'border-warn bg-warn-subtle  '
            : 'border-border bg-white  ',
        open ? 'ring-2 ring-brand' : '',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={onActivate}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="truncate text-sm font-medium">{item.title}</span>
        <span className="shrink-0 text-xs">
          {verified ? (
            <span className="text-success ">✓ đã xác nhận</span>
          ) : hasEmpty ? (
            <span className="text-warn ">⚠ thiếu thông tin</span>
          ) : (
            <span className="text-ink-muted">chưa xác nhận</span>
          )}
        </span>
      </button>

      {open && (
        <div className="mt-3 space-y-2">
          {item.fields.map((f) =>
            editing ? (
              <EditRow
                key={f.path}
                field={f}
                value={draft[f.path] ?? ''}
                onChange={(v) => setDraft((d) => ({ ...d, [f.path]: v }))}
              />
            ) : (
              <ShowRow key={f.path} field={f} />
            ),
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            {editing ? (
              <>
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={busy}
                  className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  {busy ? 'Đang lưu…' : 'Lưu'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="rounded border border-border-strong px-3 py-1.5 text-sm "
                >
                  Huỷ
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onConfirm}
                  disabled={busy || verified}
                  className="rounded bg-success px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                >
                  {verified ? '✓ Đã xác nhận' : busy ? 'Đang lưu…' : '✓ Đúng rồi'}
                </button>
                <button
                  type="button"
                  onClick={startEdit}
                  className="rounded border border-border-strong px-3 py-1.5 text-sm "
                >
                  ✎ Sửa lại
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </article>
  )
}

function ShowRow({ field }: { field: ReviewField }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2 text-sm">
      <span className="text-ink-muted">{field.label}</span>
      <span className={field.empty ? 'italic text-warn ' : ''}>
        {field.empty ? 'chưa có — bạn bổ sung giúp nhé' : field.value}
      </span>
    </div>
  )
}

function EditRow({
  field,
  value,
  onChange,
}: {
  field: ReviewField
  value: string
  onChange: (v: string) => void
}) {
  const long = field.value.length > 60 || field.label === 'Mô tả'
  return (
    <label className="grid grid-cols-[7rem_1fr] items-start gap-2 text-sm">
      <span className="pt-1.5 text-ink-muted">{field.label}</span>
      {long ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="w-full rounded border border-border-strong bg-white px-2 py-1  "
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded border border-border-strong bg-white px-2 py-1  "
        />
      )}
    </label>
  )
}
