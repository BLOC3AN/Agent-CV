'use client'

import { useId, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { devWarn } from './devWarn'

/**
 * Nút dùng chung.
 *
 * Trước khi có file này, mẫu `rounded-lg bg-sky-600 px-4 py-2` được chép lại
 * 7 lần ở 7 chỗ — lần thứ 8 sẽ lệch một sắc độ hoặc một pixel padding mà
 * không ai phát hiện.
 *
 * ── disabledReason ──
 * FRONTEND §8.1: model server không có SLA, nên nút cần AI sẽ có lúc phải tắt.
 * Tắt mà không nói lý do thì người dùng tưởng mình thao tác sai. Prop này là
 * khuyến nghị (spec D7) — thiếu thì cảnh báo ở dev, không chặn.
 *
 * ── type mặc định ──
 * HTML mặc định `<button>` thành `type="submit"`, bẫy lớn cho primitive. Nhúng
 * nút vào form rồi quên truyền `type="button"` sẽ submit form ngoài ý. Mặc định
 * ở đây là `type="button"` (ít gây hại), nhưng gọi có thể ghi đè bằng
 * `type="submit"` hay `type="reset"`.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Vì sao nút đang tắt — hiện ra cho cả người nhìn lẫn trình đọc màn hình */
  disabledReason?: string
  children: ReactNode
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-hover',
  secondary: 'border border-border-strong bg-surface text-ink hover:border-brand hover:text-brand',
  ghost: 'text-ink-muted hover:bg-canvas hover:text-ink',
  danger: 'bg-danger text-white hover:brightness-90',
}

const SIZE: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-[13px]',
  md: 'px-4 py-2 text-[15px]',
}

export function Button({
  variant = 'primary',
  size = 'md',
  type = 'button',
  disabled,
  disabledReason,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  const reasonId = useId()
  devWarn(
    Boolean(disabled) && !disabledReason,
    'Button đang disabled mà không có disabledReason — người dùng sẽ không biết vì sao bấm không được.',
  )

  const showReason = Boolean(disabled && disabledReason)

  return (
    <>
      <button
        {...rest}
        type={type}
        disabled={disabled}
        aria-describedby={showReason ? reasonId : undefined}
        className={[
          'inline-flex items-center justify-center gap-2 rounded-md font-medium',
          'transition-colors focus-visible:outline-2 focus-visible:outline-offset-2',
          'focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50',
          VARIANT[variant],
          SIZE[size],
          className,
        ].join(' ')}
      >
        {children}
      </button>
      {showReason && (
        <span id={reasonId} className="sr-only">
          {disabledReason}
        </span>
      )}
    </>
  )
}
