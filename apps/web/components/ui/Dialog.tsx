'use client'

import { useId, type ReactNode } from 'react'
import { useFocusTrap } from './useFocusTrap'

/**
 * Modal.
 *
 * Thay cho phần a11y tự làm dở dang ở PatchReviewModal: nó có role="dialog" và
 * aria-modal="true" nhưng không Escape, không bẫy focus, không trả focus —
 * tức là có nhãn đúng mà hành vi sai, kiểu lỗi khó phát hiện nhất vì công cụ
 * kiểm tra tự động vẫn báo xanh.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
}) {
  const titleId = useId()
  const ref = useFocusTrap(open, onClose)

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-ink/40"
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative z-10 max-h-[85vh] w-full max-w-2xl overflow-auto rounded-lg bg-surface shadow-md focus-visible:outline-none"
      >
        <div className="border-b border-border px-5 py-4">
          <h2 id={titleId} className="text-[18px] font-semibold text-ink">
            {title}
          </h2>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="border-t border-border px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}
