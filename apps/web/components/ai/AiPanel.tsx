'use client'

import type { ReactNode } from 'react'
import { Card, Button } from '@/components/ui'

/**
 * Khung cho mọi vùng có AI tham gia — spec §5.1 và §5.5.
 *
 * ── Một chữ ký, không cái nào tự chế ──
 * Nhìn thấy nền teal + dải gradient 3px là biết phần này do máy đề xuất chứ
 * không phải do mình khai. Chữ ký chỉ có giá trị khi nó NHẤT QUÁN, nên mọi
 * vùng AI đi qua component này.
 *
 * ── Vì sao trạng thái degrade nằm CÙNG file ──
 * TDD §3.2 A7: model server không có SLA. Chữ ký ở trên làm khối AI to và bắt
 * mắt; nếu trạng thái chết được xử lý ở nơi khác thì sẽ có chỗ quên, và chỗ
 * quên đó hiện ra thành một ô rỗng to giữa màn hình. Để chung một file thì
 * không thể thêm vùng AI mới mà quên nghĩ đến lúc nó chết.
 *
 * Khi chết, khối GIỮ NGUYÊN kích thước và nói rõ việc gì vẫn làm được —
 * FRONTEND §8.1. Nội dung AI cũ KHÔNG được hiện lại: người dùng sẽ tưởng đó
 * là gợi ý vừa sinh ra cho hồ sơ hiện tại.
 */
export function AiPanel({
  available,
  streaming = false,
  title = 'Trợ lý',
  children,
  actions,
  onRetry,
}: {
  available: boolean
  streaming?: boolean
  title?: string
  children: ReactNode
  actions?: ReactNode
  onRetry?: () => void
}) {
  if (!available) {
    return (
      <div className="rounded-lg border border-border bg-canvas p-4">
        <p className="flex items-center gap-2 text-[13px] font-medium text-ink-muted">
          <span aria-hidden="true">○</span>
          {title} đang tạm ngưng
        </p>
        <p className="mt-1 text-[13px] text-ink-muted">
          Bạn vẫn sửa CV, đổi mẫu và tải file bình thường.
        </p>
        {onRetry && (
          <div className="mt-3">
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Thử lại
            </Button>
          </div>
        )}
      </div>
    )
  }

  return (
    <Card variant="ai">
      <p className="flex items-center gap-1.5 text-[13px] font-semibold text-brand-ink">
        <span aria-hidden="true">✦</span>
        {title}
        {streaming && (
          <span
            aria-hidden="true"
            className="ml-1 inline-block h-1 w-8 animate-pulse rounded-full bg-brand motion-reduce:animate-none"
          />
        )}
      </p>

      <div
        className="mt-2 text-[15px] text-ink"
        {...(streaming ? { 'aria-live': 'polite' as const } : {})}
      >
        {children}
      </div>

      {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
    </Card>
  )
}
