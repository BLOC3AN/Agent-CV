'use client'

import { useId, useState } from 'react'
import { devWarn } from './devWarn'

/**
 * Thanh số liệu kèm phân rã — BR-02.1.
 *
 * ── Vì sao `parts` tồn tại ──
 * "Hồ sơ đã đầy đủ 85%" là con số dễ bịa nhất trong sản phẩm, và nó nằm ở màn
 * hình đầu tiên. Một con số không tra được nguồn làm người dùng nghi ngờ mọi
 * con số phía sau, kể cả điểm khớp JD vốn tính bằng code thuần.
 *
 * `parts` là khuyến nghị (spec D7) chứ không bắt buộc, nhưng thiếu nó thì
 * cảnh báo ở dev VÀ nút "Gồm những gì?" không hiện — thà không hứa còn hơn
 * hứa rồi mở ra trống.
 */

export interface MeterPart {
  key: string
  label: string
  /** Trọng số, tổng 100 */
  weight: number
  done: boolean
  /** Việc cần làm khi chưa xong — câu người dùng đọc và làm theo được */
  todo: string
}

export function Meter({
  value,
  label,
  parts,
  className = '',
}: {
  value: number
  label: string
  parts?: MeterPart[]
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const listId = useId()

  devWarn(
    !parts || parts.length === 0,
    `Meter "${label}" hiện ${value}% mà không có parts — người dùng không tra được con số này gồm những gì (BR-02.1).`,
  )

  const canExpand = Boolean(parts && parts.length > 0)
  const pct = Math.max(0, Math.min(100, Math.round(value)))

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-ink-muted">
          {label} <strong className="tabular-nums text-ink">{pct}%</strong>
        </span>
        {canExpand && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={listId}
            className="rounded-sm text-[12px] text-brand hover:text-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            {open ? 'Ẩn chi tiết' : 'Gồm những gì?'}
          </button>
        )}
      </div>

      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className="mt-2 h-2 overflow-hidden rounded-full bg-border"
      >
        <div
          className="h-full rounded-full bg-brand transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>

      {canExpand && open && (
        <ul id={listId} className="mt-3 space-y-1.5 text-[13px]">
          {parts!.map((p) => (
            <li key={p.key} className="flex items-baseline gap-2">
              <span aria-hidden="true" className={p.done ? 'text-success' : 'text-ink-subtle'}>
                {p.done ? '✓' : '○'}
              </span>
              <span className={p.done ? 'text-ink' : 'text-ink-muted'}>
                {p.label}
                <span className="ml-1 text-[12px] text-ink-subtle">({p.weight}%)</span>
              </span>
              {!p.done && p.todo && (
                <span className="ml-auto text-right text-[12px] text-ink-subtle">{p.todo}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
