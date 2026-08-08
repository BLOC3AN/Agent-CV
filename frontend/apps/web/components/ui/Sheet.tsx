'use client'

import { useId, type ReactNode } from 'react'
import { useFocusTrap } from './useFocusTrap'

/**
 * Bảng trượt từ phải — dùng cho chat tư vấn.
 *
 * FRONTEND §3.1: laptop 1366×768 không đủ cho ba pane cố định; chat phải ĐÈ
 * LÊN chứ không chiếm chỗ thường trực, nếu không vùng xem trước CV còn ~500px
 * và không đọc được.
 *
 * Dùng chung `useFocusTrap` với Dialog: cả hai đều là lớp phủ chặn nền, nên
 * ràng buộc bàn phím giống hệt nhau. Khác nhau chỉ ở vị trí và hiệu ứng vào.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  width = 380,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  width?: number
}) {
  const titleId = useId()
  const ref = useFocusTrap(open, onClose)

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50">
      <div aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-ink/30" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ width }}
        className="absolute right-0 top-0 flex h-full max-w-full flex-col border-l border-border bg-surface shadow-md focus-visible:outline-none"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 id={titleId} className="text-[15px] font-semibold text-ink">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Đóng bảng ${title}`}
            className="rounded-sm px-2 py-1 text-ink-muted hover:bg-canvas hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <div className="flex-1 overflow-auto px-4 py-4">{children}</div>
      </div>
    </div>
  )
}
