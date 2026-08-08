import { NextResponse } from 'next/server'
import { z } from 'zod'
import { buildReviewItems, reviewProgress } from '@hr/schema'
import { profileRepo } from '@/lib/db'

/**
 * POST /api/profiles/:id/verify — xác nhận đã rà soát (UC-22 bước 4).
 *
 * Tách khỏi `PATCH /api/profiles/:id` vì "Đúng rồi" không đổi giá trị nào; ép
 * nó qua đường patch sẽ sinh revision rỗng trong lịch sử hoàn tác.
 */

type Ctx = { params: Promise<{ id: string }> }

const Body = z.object({
  paths: z.array(z.string().startsWith('/')).min(1).max(200),
  verified: z.boolean().default(true),
})

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Body không hợp lệ', issues: parsed.error.issues.slice(0, 5) },
      { status: 400 },
    )
  }

  const current = await profileRepo().get(id)
  if (!current) return NextResponse.json({ error: 'Không tìm thấy hồ sơ' }, { status: 404 })

  // Chỉ cho xác nhận những mục THẬT SỰ có trong hồ sơ. Không kiểm thì client
  // gửi bừa `/education/99` là đủ để `reviewProgress` báo hoàn tất và lọt qua
  // chốt chặn BR-22.1.
  const items = buildReviewItems(current)
  const valid = new Set(items.map((i) => i.path))
  const unknown = parsed.data.paths.filter((p) => !valid.has(p))
  if (unknown.length > 0) {
    return NextResponse.json(
      { error: 'Có mục không tồn tại trong hồ sơ', unknown },
      { status: 422 },
    )
  }

  const profile = await profileRepo().verify(id, parsed.data.paths, parsed.data.verified)
  return NextResponse.json({
    profile,
    progress: reviewProgress(buildReviewItems(profile), profile._meta.verified),
  })
}
