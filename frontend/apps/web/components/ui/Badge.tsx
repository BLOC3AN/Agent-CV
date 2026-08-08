import type { ReactNode } from 'react'

/**
 * Nhãn trạng thái.
 *
 * `icon` và `children` đều BẮT BUỘC — FRONTEND §9.8: màu không được là kênh
 * thông tin duy nhất. Một chấm đỏ không nói được gì với người mù màu, và cũng
 * không nói được gì trong ảnh chụp màn hình đen trắng gửi qua chat hỗ trợ.
 *
 * `tone="ai"` dùng teal — theo quy tắc token: teal chỉ thuộc về brand và AI.
 */

export type BadgeTone = 'neutral' | 'success' | 'warn' | 'danger' | 'ai'

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-canvas text-ink-muted border-border',
  success: 'bg-success-subtle text-success border-success/30',
  warn: 'bg-warn-subtle text-warn border-warn/30',
  danger: 'bg-danger-subtle text-danger border-danger/30',
  ai: 'bg-brand-subtle text-brand-ink border-brand-border',
}

export function Badge({
  tone = 'neutral',
  icon,
  children,
}: {
  tone?: BadgeTone
  /** Ký tự hoặc emoji — luôn đi kèm chữ, không bao giờ đứng một mình */
  icon: string
  children: ReactNode
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[12px] font-medium ${TONE[tone]}`}
    >
      <span aria-hidden="true">{icon}</span>
      {children}
    </span>
  )
}
