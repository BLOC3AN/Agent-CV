import { NextResponse } from 'next/server'
import { z } from 'zod'
import { PatchOpSchema } from '@hr/schema'
import { profileRepo } from '@/lib/db'

type Ctx = { params: Promise<{ id: string }> }

/** GET /api/profiles/:id */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params
  const profile = await profileRepo().get(id)
  if (!profile) return NextResponse.json({ error: 'Không tìm thấy' }, { status: 404 })
  return NextResponse.json({ profile })
}

const PatchBody = z.object({
  ops: z.array(PatchOpSchema).min(1).max(50),
  author: z.enum(['user', 'ai', 'import']).default('user'),
  messageId: z.string().uuid().optional(),
})

/**
 * PATCH /api/profiles/:id — áp JSON Patch (UC-24, UC-53).
 * Cùng một endpoint cho thay đổi của người và của AI (BR-24.1).
 */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params
  const parsed = PatchBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Body không hợp lệ', issues: parsed.error.issues.slice(0, 5) },
      { status: 400 },
    )
  }
  try {
    const r = await profileRepo().patch(
      id, parsed.data.ops, parsed.data.author, parsed.data.messageId,
    )
    return NextResponse.json({
      profile: r.profile,
      revisionId: r.revisionId,
      applied: r.applied.length,
      // UC-53 6a: báo rõ op nào bị bỏ và vì sao
      rejected: r.rejected.map((x: { op: { path: string }; reason: string }) =>
        ({ path: x.op.path, reason: x.reason })),
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 422 })
  }
}
