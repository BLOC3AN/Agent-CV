import Link from 'next/link'
import type { Profile } from '@hr/schema'
import { profileRepo } from '@/lib/db'
import { jobRepo, splitError } from '@/lib/jobs'
import { ReviewShell } from '@/components/review/ReviewShell'
import { parseIntent } from '@/lib/intent'

/**
 * `/import/:jobId/review` — màn hình rà soát bắt buộc (UC-22).
 *
 * Dữ liệu lấy ở SERVER rồi truyền xuống: màn hình này là chốt chặn chất lượng,
 * hiện khung rỗng rồi mới tải nội dung sẽ khiến user bấm "Đúng rồi" trước khi
 * kịp đọc.
 */

export const dynamic = 'force-dynamic'

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { jobId } = await params
  const sp = await searchParams
  const intent = parseIntent(typeof sp['intent'] === 'string' ? sp['intent'] : null)
  const job = await jobRepo().get(jobId)

  if (!job) return <Notice title="Không tìm thấy lượt tải lên này" />

  if (job.status === 'queued' || job.status === 'running') {
    return (
      <Notice
        title="Đang đọc CV của bạn…"
        body="Việc này mất khoảng một phút. Bạn cứ để tab này mở, hoặc đóng lại rồi quay lại sau — kết quả vẫn được giữ."
        // Tự tải lại: job xong thì trang chuyển sang màn rà soát mà không cần
        // user bấm gì. SSE dành cho màn hình chờ có thanh tiến độ riêng.
        refresh
      />
    )
  }

  if (job.status === 'failed' || job.status === 'cancelled') {
    const err = splitError(job.error)
    return <FailureNotice code={err?.code ?? 'INTERNAL'} message={err?.message ?? ''} />
  }

  const result = (job.result ?? {}) as Record<string, unknown>
  const profileId = result['profileId'] as string | undefined
  const profile = profileId ? await profileRepo().get(profileId) : null

  if (!profileId || !profile) {
    return <Notice title="Không tìm thấy hồ sơ của lượt tải lên này" />
  }

  return (
    <ReviewShell
      intent={intent}
      jobId={jobId}
      profileId={profileId}
      initialProfile={profile as Profile}
      quality={{
        level: String(result['quality'] ?? 'good'),
        warning: result['qualityWarning'] === true,
        reasons: (result['reasons'] as string[]) ?? [],
        pages: (result['pages'] as number) ?? 1,
      }}
    />
  )
}

/**
 * BR-71.1: không bao giờ có màn hình lỗi trắng. Mỗi mã lỗi phải dẫn tới một
 * hành động tiếp theo cụ thể, không phải một nút "Thử lại" vô nghĩa.
 */
function FailureNotice({ code, message }: { code: string; message: string }) {
  const GUIDE: Record<string, { title: string; body: string; cta: string; href: string }> = {
    NO_TEXT_LAYER: {
      title: 'File này là ảnh chụp, chưa đọc được chữ',
      body: 'CV của bạn được lưu dưới dạng ảnh nên hệ thống chưa trích được nội dung. Bạn nhập tay giúp nhé — chỉ mất vài phút và kết quả chính xác hơn.',
      cta: 'Nhập tay',
      href: '/cv/new',
    },
    NO_SECTIONS: {
      title: 'Chưa nhận ra các mục trong CV',
      body: 'Có thể CV dùng bố cục ít gặp. Bạn thử tải lên bản PDF xuất từ Word/Google Docs, hoặc nhập tay.',
      cta: 'Nhập tay',
      href: '/cv/new',
    },
    PARSE_EMPTY: {
      title: 'Chưa trích được nội dung nào',
      body: 'Hệ thống đọc được chữ nhưng không dựng được hồ sơ. Bạn nhập tay giúp nhé.',
      cta: 'Nhập tay',
      href: '/cv/new',
    },
    BAD_FILE: {
      title: 'File không đọc được',
      body: 'File có thể bị hỏng hoặc đặt mật khẩu. Bạn thử xuất lại bản PDF mới rồi tải lên.',
      cta: 'Tải lên lại',
      href: '/import',
    },
  }

  const g = GUIDE[code] ?? {
    title: 'Chưa xử lý được file này',
    body: message || 'Đã có lỗi trong lúc đọc CV. Bạn thử tải lại file, hoặc nhập tay.',
    cta: 'Tải lên lại',
    href: '/import',
  }

  return (
    <div className="mx-auto max-w-xl p-8">
      <h1 className="text-lg font-semibold">{g.title}</h1>
      <p className="mt-2 text-neutral-600 dark:text-neutral-400">{g.body}</p>
      <div className="mt-5 flex gap-3">
        <Link
          href={g.href}
          className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white"
        >
          {g.cta}
        </Link>
        <Link
          href="/import"
          className="rounded border border-neutral-300 px-4 py-2 text-sm dark:border-neutral-600"
        >
          Chọn file khác
        </Link>
      </div>
      <p className="mt-6 text-xs text-neutral-400">Mã lỗi: {code}</p>
    </div>
  )
}

function Notice({
  title,
  body,
  refresh,
}: {
  title: string
  body?: string
  refresh?: boolean
}) {
  return (
    <div className="mx-auto max-w-xl p-8">
      {refresh && <meta httpEquiv="refresh" content="4" />}
      <h1 className="text-lg font-semibold">{title}</h1>
      {body && <p className="mt-2 text-neutral-600 dark:text-neutral-400">{body}</p>}
    </div>
  )
}
