import type { ReactNode } from 'react'

/**
 * Đầu mục + khoảng cách chuẩn.
 *
 * Trước đây `<h2 className="text-sm font-semibold uppercase tracking-wide
 * text-ink-muted">` được chép lại ở 3 chỗ chỉ riêng trong ReturningHome.
 *
 * Dùng `<h2>` thật chứ không phải div tô đậm: trình đọc màn hình duyệt trang
 * bằng danh sách heading, và một trang toàn div là một trang không duyệt được.
 */
export function Section({
  title,
  action,
  className = '',
  children,
}: {
  title: string
  action?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section className={`mt-8 ${className}`}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  )
}
