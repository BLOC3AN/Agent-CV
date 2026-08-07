import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ChatRepo, getPool } from '@hr/db'
import { profileRepo } from '@/lib/db'

/**
 * POST /api/chat/proposals/:id — áp dụng các op ĐƯỢC CHỌN (UC-53 bước 5-7).
 *
 * BR-53.1: AI không bao giờ ghi thẳng vào hồ sơ. Đây là cửa duy nhất, và nó
 * chỉ mở khi user đã tick.
 */

export const dynamic = 'force-dynamic'

const Body = z.object({
  profileId: z.string().uuid(),
  /** Chỉ số các op user đã tick. Mảng rỗng = từ chối tất cả. */
  accept: z.array(z.number().int().min(0)).max(20),
})

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Body không hợp lệ' }, { status: 400 })
  }
  const { profileId, accept } = parsed.data

  const chat = new ChatRepo(getPool())
  const proposal = await chat.getProposal(id)
  if (!proposal) return NextResponse.json({ error: 'Không tìm thấy đề xuất' }, { status: 404 })
  if (proposal.status !== 'pending') {
    return NextResponse.json(
      { error: `Đề xuất này đã ${proposal.status}` },
      { status: 409 },
    )
  }

  // Chỉ số vượt phạm vi = client gửi sai. Chặn ở đây chứ không lặng lẽ bỏ:
  // user tick 3 op mà chỉ 2 op được áp dụng thì họ không biết op nào trượt.
  const invalid = accept.filter((i) => i >= proposal.ops.length)
  if (invalid.length > 0) {
    return NextResponse.json({ error: 'Chỉ số op không hợp lệ', invalid }, { status: 422 })
  }

  // UC-53 5a: bỏ chọn tất cả → ghi nhận từ chối, KHÔNG đụng hồ sơ
  if (accept.length === 0) {
    await chat.settleProposal(id, [])
    return NextResponse.json({ applied: 0, status: 'rejected' })
  }

  const ops = accept.map((i) => proposal.ops[i]!)

  try {
    const r = await profileRepo().patch(profileId, ops, 'ai', proposal.messageId)
    await chat.settleProposal(id, accept)

    return NextResponse.json({
      applied: r.applied.length,
      // UC-53 6a: op không áp được bị bỏ RIÊNG, phần còn lại vẫn ghi
      rejected: r.rejected.map((x) => ({ path: x.op.path, reason: x.reason })),
      revisionId: r.revisionId,
      profile: r.profile,
      status: accept.length === proposal.ops.length ? 'accepted' : 'partial',
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 422 })
  }
}
