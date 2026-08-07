import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getPool, MatchRepo } from '@hr/db'
import { jobKey } from '@hr/worker/storage'
import { enqueue } from '@/lib/jobs'
import { requireUserId } from '@/lib/auth'

/**
 * POST /api/analyze — dán JD và bắt đầu đối chiếu (UC-41, UC-33).
 *
 * Trả `jobId` ngay. Phân tích mất ~5 giây cho điểm và tới ~70 giây cho lời
 * khuyên, nên nó chạy ở worker chứ không trong request (TDD §8.2).
 */

export const dynamic = 'force-dynamic'

const Body = z.object({
  cvId: z.string().uuid(),
  jdText: z.string().min(50, 'Mô tả công việc quá ngắn để phân tích'),
  sourceUrl: z.string().url().optional(),
  language: z.enum(['vi', 'en']).default('vi'),
  /**
   * UC-33: tạo bản CV riêng cho JD này.
   *
   * Mặc định BẬT — người dùng thật ứng tuyển nhiều nơi, và "làm gọn cho JD này"
   * không được phép hỏng bản đầy đủ đang dùng cho nơi khác (BR-33.3).
   */
  createVariant: z.boolean().default(true),
})

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Body không hợp lệ' },
      { status: 400 },
    )
  }
  const { cvId, jdText, sourceUrl, language, createVariant } = parsed.data

  let userId: string
  try {
    userId = await requireUserId()
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 })
  }

  const repo = new MatchRepo(getPool())

  const source = await repo.profileOfCv(cvId)
  if (!source) return NextResponse.json({ error: 'Không tìm thấy CV' }, { status: 404 })

  const jdId = await repo.saveJd({
    userId,
    rawText: jdText,
    ...(sourceUrl ? { sourceUrl } : {}),
    language,
  })

  // Nhân bản IM LẶNG (BR-33.1). Người dùng không thấy bước này — họ chỉ thấy
  // mình chuyển sang màn hình phân tích.
  let targetCvId = cvId
  let variantCreated = false
  if (createVariant) {
    const clone = await repo.cloneForJd({
      sourceCvId: cvId,
      jdId,
      // Tên lấy từ JD, không phải "CV (bản sao 2)" — user cần nhận ra ngay
      // bản nào cho nơi nào (BR-33.4). JD chưa parse nên tạm dùng dòng đầu.
      title: titleFromJd(jdText),
    })
    targetCvId = clone.cvId
    variantCreated = clone.created
  }

  const r = await enqueue({
    userId,
    kind: 'match_analysis',
    idempotencyKey: jobKey('match_analysis', targetCvId, jdId),
    payload: { cvId: targetCvId, jdId },
  })

  return NextResponse.json(
    { jobId: r.jobId, cvId: targetCvId, jdId, variantCreated, queued: r.queued },
    { status: r.created ? 202 : 200 },
  )
}

/**
 * Đặt tên CV từ JD trước khi model kịp parse.
 *
 * Lấy dòng tiêu đề đầu tiên có nội dung. Sau khi `parse_jd` chạy xong, worker
 * biết chính xác `title` và công ty — nhưng người dùng đã nhìn thấy tên này
 * trong danh sách rồi, nên nó phải hợp lý ngay từ đầu.
 */
function titleFromJd(text: string): string {
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^#+\s*/, '').replace(/\*\*/g, '').trim()
    if (line.length >= 6 && line.length <= 80) return line
  }
  return 'CV theo tin tuyển dụng'
}
