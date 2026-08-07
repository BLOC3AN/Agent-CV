import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getPool } from '@hr/db'

/**
 * GET  /api/kb — danh sách nguồn + đoạn tri thức, cho màn hình duyệt (UC-62)
 * PATCH /api/kb — đổi trạng thái nguồn / bổ sung tên tác giả
 *
 * §10.4: nguồn KHÔNG có tên tác giả không được đưa vào `active`. Đây là điều
 * kiện để lời khuyên hiển thị được "Theo [Tên] — [Chức danh]"; thiếu nó thì mọi
 * lời khuyên rơi xuống nhãn "gợi ý chung của AI" và mất hết giá trị tin cậy.
 */

export const dynamic = 'force-dynamic'

export async function GET() {
  const { rows: sources } = await getPool().query<{
    id: string
    slug: string
    title: string
    author_name: string
    author_title: string | null
    language: string
    status: string
    version: number
    chunk_count: string
  }>(
    `SELECT s.id, s.slug, s.title, s.author_name, s.author_title, s.language,
            s.status, s.version,
            (SELECT count(*) FROM kb_chunks c WHERE c.source_id = s.id)::text AS chunk_count
       FROM kb_sources s
      ORDER BY s.created_at DESC`,
  )

  return NextResponse.json({
    sources: sources.map((s) => ({
      id: s.id,
      slug: s.slug,
      title: s.title,
      authorName: s.author_name,
      authorTitle: s.author_title,
      language: s.language,
      status: s.status,
      version: s.version,
      chunkCount: Number(s.chunk_count),
      // Chưa có người duyệt thì không thể kích hoạt — hiện lý do luôn để
      // curator không phải đoán vì sao nút bị mờ
      canActivate: s.author_name !== 'Chưa có người duyệt' && s.author_name.trim() !== '',
    })),
  })
}

const PatchBody = z.object({
  sourceId: z.string().uuid(),
  status: z.enum(['draft', 'pending_review', 'active', 'archived']).optional(),
  authorName: z.string().min(2).optional(),
  authorTitle: z.string().optional(),
})

export async function PATCH(req: Request) {
  const parsed = PatchBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Body không hợp lệ' }, { status: 400 })
  }
  const { sourceId, status, authorName, authorTitle } = parsed.data

  const cur = await getPool().query<{ author_name: string }>(
    'SELECT author_name FROM kb_sources WHERE id = $1',
    [sourceId],
  )
  if (cur.rowCount === 0) {
    return NextResponse.json({ error: 'Không tìm thấy nguồn' }, { status: 404 })
  }

  const nextAuthor = authorName ?? cur.rows[0]!.author_name
  const noRealAuthor = nextAuthor === 'Chưa có người duyệt' || nextAuthor.trim() === ''

  // Chốt chặn ở SERVER, không chỉ ở nút bị làm mờ
  if (status === 'active' && noRealAuthor) {
    return NextResponse.json(
      {
        error:
          'Chưa thể kích hoạt: nguồn này chưa có tên người chịu trách nhiệm. ' +
          'Mọi lời khuyên phải trích dẫn được về một người thật.',
      },
      { status: 422 },
    )
  }

  await getPool().query(
    `UPDATE kb_sources
        SET status = COALESCE($2, status),
            author_name = COALESCE($3, author_name),
            author_title = COALESCE($4, author_title)
      WHERE id = $1`,
    [sourceId, status ?? null, authorName ?? null, authorTitle ?? null],
  )

  return NextResponse.json({ ok: true })
}
