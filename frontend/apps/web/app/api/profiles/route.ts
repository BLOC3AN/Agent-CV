import { NextResponse } from 'next/server'
import { ProfileSchema } from '@hr/schema'
import { profileRepo } from '@/lib/db'
import { getPool } from '@hr/db'

/** POST /api/profiles — tạo Profile mới (UC-23) */
interface CreateBody {
  profile?: unknown
  userId?: string
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as CreateBody | null
  const parsed = ProfileSchema.safeParse(body?.profile)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Profile không hợp lệ', issues: parsed.error.issues.slice(0, 5) },
      { status: 400 },
    )
  }
  // TODO(X-1 Auth): lấy userId từ session thay vì body
  const userId = body?.userId
  if (!userId) return NextResponse.json({ error: 'Thiếu userId' }, { status: 400 })

  const { rows } = await getPool().query('SELECT 1 FROM users WHERE id = $1', [userId])
  if (rows.length === 0) return NextResponse.json({ error: 'Không có user' }, { status: 404 })

  const r = await profileRepo().create(userId, parsed.data)
  return NextResponse.json({ id: r.id, profile: r.profile }, { status: 201 })
}
