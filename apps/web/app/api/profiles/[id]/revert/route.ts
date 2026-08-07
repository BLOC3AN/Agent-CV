import { NextResponse } from 'next/server'
import { z } from 'zod'
import { profileRepo } from '@/lib/db'

/**
 * POST /api/profiles/:id/revert — khôi phục về một mốc trong lịch sử (UC-34).
 *
 * BR-34.2: khôi phục KHÔNG xoá lịch sử phía sau. Nó tự là một thay đổi mới,
 * nên hoàn tác được tiếp — người dùng bấm nhầm vẫn quay lại được.
 */

const Body = z.object({ revisionId: z.string().min(1) })

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Thiếu revisionId' }, { status: 400 })
  }

  try {
    const profile = await profileRepo().revertTo(id, parsed.data.revisionId)
    return NextResponse.json({ profile })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 422 })
  }
}
