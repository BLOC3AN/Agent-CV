import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getPool } from '@hr/db'
import { TEMPLATE_IDS } from '@hr/templates'

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
