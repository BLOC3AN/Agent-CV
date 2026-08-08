import { NextResponse } from 'next/server'
import { buildReviewItems, reviewProgress } from '@hr/schema'
import { getPool } from '@hr/db'
import { profileRepo } from '@/lib/db'
import { jobRepo } from '@/lib/jobs'

/**
 * POST /api/imports/:jobId/complete — kết thúc rà soát, tạo CV (UC-22 bước 6).
 *
 * **BR-22.1 được chốt Ở ĐÂY, không chỉ ở nút bị làm mờ.** Nút disabled chỉ là
 * gợi ý giao diện; ai gọi thẳng API vẫn vào được `/builder` với hồ sơ chưa rà
 * soát, và mọi phân tích sau đó sẽ dựa trên dữ liệu chưa ai kiểm.
 */

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params

  const job = await jobRepo().get(jobId)
  if (!job) return NextResponse.json({ error: 'Không tìm thấy job' }, { status: 404 })
  if (job.status !== 'done') {
    return NextResponse.json({ error: `Job đang ở trạng thái ${job.status}` }, { status: 409 })
  }

  const profileId = (job.result as { profileId?: string } | null)?.profileId
  if (!profileId) return NextResponse.json({ error: 'Job không có hồ sơ' }, { status: 500 })

  const profile = await profileRepo().get(profileId)
  if (!profile) return NextResponse.json({ error: 'Không tìm thấy hồ sơ' }, { status: 404 })

  const progress = reviewProgress(buildReviewItems(profile), profile._meta.verified)
  if (!progress.complete) {
    return NextResponse.json(
      {
        error: 'Còn mục chưa rà soát',
        pending: progress.pending,
        progress,
      },
      { status: 409 },
    )
  }

  // Một job chỉ tạo một CV. Gọi lại (F5, hai tab) trả về cái đã có.
  const existing = await getPool().query<{ id: string }>(
    'SELECT id FROM cv_documents WHERE profile_id = $1 ORDER BY created_at LIMIT 1',
    [profileId],
  )
  if (existing.rows.length > 0) {
    return NextResponse.json({ cvId: existing.rows[0]!.id, created: false })
  }

  // `profile_snapshot` là BẮT BUỘC (TDD A2): CV đã xuất không được đổi khi
  // Profile thay đổi về sau.
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO cv_documents (user_id, profile_id, profile_snapshot, title, language)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [job.userId, profileId, profile, profile.basics.name || 'CV của tôi', profile.language],
  )
  return NextResponse.json({ cvId: rows[0]!.id, created: true }, { status: 201 })
}
