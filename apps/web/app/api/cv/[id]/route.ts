import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getPool } from '@hr/db'
import { TEMPLATE_IDS } from '@hr/templates'
import { NotAuthenticated, requireUser } from '@/lib/auth'

type Ctx = { params: Promise<{ id: string }> }

/**
 * PATCH /api/cv/:id — cập nhật cách TRÌNH BÀY (UC-31).
 *
 * BR-31.2: đổi mẫu/theme/layout KHÔNG đụng tới Profile. Dữ liệu và cách trình
 * bày tách rời (TDD A2) — đó là lý do endpoint này hoàn toàn riêng với
 * /api/profiles/:id.
 */
const Body = z.object({
  templateId: z.enum(TEMPLATE_IDS as [string, ...string[]]).optional(),
  theme: z.record(z.unknown()).optional(),
  layout: z
    .object({
      columns: z.union([z.literal(1), z.literal(2)]).optional(),
      order: z.array(z.string()).optional(),
      hidden: z.array(z.string()).optional(),
      sidebar: z.array(z.string()).optional(),
    })
    .optional(),
  title: z.string().min(1).max(200).optional(),
})

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Body không hợp lệ', issues: parsed.error.issues.slice(0, 5) },
      { status: 400 },
    )
  }
  const b = parsed.data
  const sets: string[] = []
  const vals: unknown[] = []
  const push = (col: string, v: unknown) => {
    vals.push(v)
    sets.push(`${col} = $${vals.length}`)
  }
  if (b.templateId) push('template_id', b.templateId)
  if (b.theme) push('theme', JSON.stringify(b.theme))
  if (b.layout) push('layout', JSON.stringify(b.layout))
  if (b.title) push('title', b.title)
  if (sets.length === 0) return NextResponse.json({ error: 'Không có gì để đổi' }, { status: 400 })

  vals.push(id)
  const { rows } = await getPool().query(
    `UPDATE cv_documents SET ${sets.join(', ')} WHERE id = $${vals.length}
     RETURNING id, template_id, theme, layout, title`,
    vals,
  )
  if (rows.length === 0) return NextResponse.json({ error: 'Không tìm thấy' }, { status: 404 })
  return NextResponse.json({ cv: rows[0] })
}

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params
  const { rows } = await getPool().query(
    `SELECT id, profile_id, template_id, theme, layout, title, language
     FROM cv_documents WHERE id = $1`,
    [id],
  )
  if (rows.length === 0) return NextResponse.json({ error: 'Không tìm thấy' }, { status: 404 })
  return NextResponse.json({ cv: rows[0] })
}

/**
 * DELETE /api/cv/:id — xoá một CV khỏi danh sách (UC-31).
 *
 * Chỉ chủ sở hữu mới được xoá. CV là bản trình bày của một Profile, nên xoá
 * luôn Profile nếu không còn CV nào tham chiếu tới nó; các bảng phụ thuộc CV
 * đã khai báo ON DELETE CASCADE trong schema.
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  let user
  try {
    user = await requireUser()
  } catch (e) {
    if (e instanceof NotAuthenticated) return NextResponse.json({ error: e.message }, { status: 401 })
    throw e
  }

  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const deleted = await client.query<{ profile_id: string }>(
      `DELETE FROM cv_documents
        WHERE id = $1 AND user_id = $2
        RETURNING profile_id`,
      [(await params).id, user.id],
    )
    if (deleted.rows.length === 0) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'Không tìm thấy CV' }, { status: 404 })
    }

    await client.query(
      `DELETE FROM profiles p
        WHERE p.id = $1
          AND NOT EXISTS (SELECT 1 FROM cv_documents c WHERE c.profile_id = p.id)`,
      [deleted.rows[0]!.profile_id],
    )
    await client.query('COMMIT')
    return NextResponse.json({ deleted: true })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}
