import type { ReactNode } from 'react'

/**
 * Vỏ thẻ dùng chung — thay cho `rounded-xl border border-border p-4`
 * được chép lại 7 lần.
 *
 * Biến thể `ai` là CHỮ KÝ THỊ GIÁC của máy (spec §5.1): nền teal nhạt, viền
 * teal, và dải 3px phía trên. Nhìn thấy nó là biết phần này do máy đề xuất
 * chứ không phải do mình khai. `data-variant` để test kiểm được mà không bám
 * vào className.
 */

export type CardVariant = 'default' | 'ai' | 'raised'

const VARIANT: Record<CardVariant, string> = {
  default: 'bg-surface border border-border',
  ai: 'bg-brand-subtle border border-brand-border',
  raised: 'bg-surface border border-border shadow-sm',
}

export function Card({
  variant = 'default',
  className = '',
  children,
  ...rest
}: {
  variant?: CardVariant
  className?: string
  children: ReactNode
} & Record<`data-${string}`, string | undefined>) {
  return (
    <div
      {...rest}
      data-variant={variant}
      className={`relative overflow-hidden rounded-lg p-4 ${VARIANT[variant]} ${className}`}
    >
      {variant === 'ai' && (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-brand to-brand-border"
        />
      )}
      {children}
    </div>
  )
}
