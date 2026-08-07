import { NextResponse } from 'next/server'
import { buildReviewItems, reviewProgress } from '@hr/schema'
import { profileRepo } from '@/lib/db'
import { jobRepo, splitError } from '@/lib/jobs'

/**
 * GET /api/imports/:jobId — dữ liệu cho màn hình rà soát (UC-22).
 *
 * Gộp job + profile + danh sách mục cần rà soát vào MỘT lượt gọi: màn hình này
 * không hiển thị được gì cho tới khi có đủ cả ba, nên tách ra chỉ tạo thêm ba
 * trạng thái tải khác nhau mà không nhanh hơn.
 */

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params

  const job = await jobRepo().get(jobId)
  if (!job) return NextResponse.json({ error: 'Không tìm thấy job' }, { status: 404 })

  if (job.status !== 'done') {
    // Chưa xong không phải lỗi — FE hiện màn hình chờ hoặc lời mời nhập tay
    return NextResponse.json({
      status: job.status,
      error: splitError(job.error),
      ready: false,
    })
  }

  const result = (job.result ?? {}) as Record<string, unknown>
  const profileId = result['profileId'] as string | undefined
  if (!profileId) {
    return NextResponse.json({ error: 'Job không trả về profileId' }, { status: 500 })
  }

  const profile = await profileRepo().get(profileId)
  if (!profile) return NextResponse.json({ error: 'Không tìm thấy hồ sơ' }, { status: 404 })

  const items = buildReviewItems(profile)

  return NextResponse.json({
    ready: true,
    status: job.status,
    profileId,
    profile,
    items,
    progress: reviewProgress(items, profile._meta.verified),
    // Cảnh báo chất lượng đi kèm để màn hình nói rõ vì sao có thể đọc sai
    quality: {
      level: result['quality'] ?? 'good',
      warning: result['qualityWarning'] === true,
      reasons: (result['reasons'] as string[]) ?? [],
      engine: result['engine'],
      pages: (result['pages'] as number) ?? 1,
    },
    sections: result['sections'] ?? [],
  })
}
