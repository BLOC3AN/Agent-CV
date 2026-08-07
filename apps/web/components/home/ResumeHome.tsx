import Link from 'next/link'
import type { HomeJob } from '@/lib/home-state'

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
      {failed ? (
        <>
          <h1 className="text-2xl font-semibold">Lần đọc CV vừa rồi chưa xong</h1>
          {/*
            Nói rõ hỏng gì rồi mời làm tiếp — không im lặng đưa họ về màn hình
            đầu như chưa có chuyện gì (BR-03.1, nối UC-71).
          */}
          <p className="mt-3 text-neutral-600 dark:text-neutral-300">
            Hệ thống chưa đọc được <strong>{name}</strong>. Bạn thử tải lại, hoặc
            nhập tay những mục chính — cách nào cũng ra cùng một hồ sơ.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/import"
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700"
            >
              Thử tải lại
            </Link>
            <Link
              href="/"
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm dark:border-neutral-600"
            >
              Chọn cách khác
            </Link>
          </div>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-semibold">Bạn đang làm dở một việc</h1>
          <p className="mt-3 text-neutral-600 dark:text-neutral-300">
            Hệ thống đang đọc <strong>{name}</strong>. Bạn tiếp tục từ chỗ đang dở nhé.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href={`/import/${job.id}/review`}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700"
            >
              Tiếp tục
            </Link>
            <Link
              href="/import"
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm dark:border-neutral-600"
            >
              Bắt đầu lại với file khác
            </Link>
          </div>
        </>
      )}
    </main>
  )
}
