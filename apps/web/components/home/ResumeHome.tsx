import Link from 'next/link'
import type { HomeJob } from '@/lib/home-state'
import { Card } from '@/components/ui'

/**
 * Home "tiếp tục việc dở dang" — UC-03, PRODUCT §3.1.
 *
 * ── Vì sao đây là màn hình riêng ──
 * Người tải CV lên rồi đóng tab giữa màn rà soát đã có `job` nhưng CHƯA có
 * `Profile`. Chiếu Home lần đầu cho họ là xoá sạch công họ vừa bỏ ra và bắt
 * bắt đầu lại từ số không — trong ba trạng thái thì đây là lỗi tệ nhất, vì nó
 * làm mất thứ người dùng đã bỏ công tạo ra.
 */

interface Props {
  job: HomeJob
}

export function ResumeHome({ job }: Props) {
  const failed = job.status === 'failed'
  const name = job.filename ?? 'CV của bạn'

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Card
        variant="raised"
        className={failed ? 'border-danger/40' : ''}
        {...(failed ? { 'data-tone': 'danger' as const } : {})}
      >
        {failed ? (
          <>
            <h1 className="text-2xl font-semibold text-ink">Lần đọc CV vừa rồi chưa xong</h1>
            {/*
              Nói rõ hỏng gì rồi mời làm tiếp — không im lặng đưa họ về màn hình
              đầu như chưa có chuyện gì (BR-03.1, nối UC-71).
            */}
            <p className="mt-3 text-ink-muted">
              Hệ thống chưa đọc được <strong>{name}</strong>. Bạn thử tải lại, hoặc
              nhập tay những mục chính — cách nào cũng ra cùng một hồ sơ.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/import"
                className="rounded-md bg-brand px-4 py-2 text-[15px] font-medium text-white transition-colors hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                Thử tải lại
              </Link>
              <Link
                href="/"
                className="rounded-md border border-border-strong px-4 py-2 text-[15px] text-ink transition-colors hover:border-brand hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                Chọn cách khác
              </Link>
            </div>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold text-ink">Bạn đang làm dở một việc</h1>
            <p className="mt-3 text-ink-muted">
              Hệ thống đang đọc <strong>{name}</strong>. Bạn tiếp tục từ chỗ đang dở nhé.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href={`/import/${job.id}/review`}
                className="rounded-md bg-brand px-4 py-2 text-[15px] font-medium text-white transition-colors hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                Tiếp tục
              </Link>
              <Link
                href="/import"
                className="rounded-md border border-border-strong px-4 py-2 text-[15px] text-ink transition-colors hover:border-brand hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                Bắt đầu lại với file khác
              </Link>
            </div>
          </>
        )}
      </Card>
    </main>
  )
}
