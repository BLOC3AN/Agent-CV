import { NextResponse } from 'next/server'
import { getPool } from '@hr/db'
import { exportPdf, type ExportVariant } from '@hr/pdf'
import { requireUserId } from '@/lib/auth'

/**
 * GET /api/cv/:id/export?variant=presentation|ats — UC-32.
 *
 * BR-32.4: KHÔNG cần LLM → hoạt động bình thường khi model server chết
 * (TC-32-06). Đây là một trong những tính năng phải sống sót ở TDD §5.5.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const VALID: ExportVariant[] = ['presentation', 'ats']

function baseUrl(req: Request): string {
  const env = process.env.APP_URL
  if (env) return env.replace(/\/$/, '')
  const u = new URL(req.url)
  return `${u.protocol}//${u.host}`
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const q = new URL(req.url).searchParams.get('variant') ?? 'presentation'
  const variant = (VALID as string[]).includes(q) ? (q as ExportVariant) : 'presentation'

  let userId: string
  try {
    userId = await requireUserId()
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 401 })
  }

  const { rows } = await getPool().query<{ title: string | null; language: string }>(
    'SELECT title, language FROM cv_documents WHERE id = $1 AND user_id = $2',
    [id, userId],
  )
  if (rows.length === 0) {
    return NextResponse.json({ error: 'Không tìm thấy CV' }, { status: 404 })
  }

  try {
    const r = await exportPdf({
      url: `${baseUrl(req)}/print/${id}`,
      variant,
    })

    await getPool().query(
      `INSERT INTO export_artifacts (cv_id, variant, file_key, bytes) VALUES ($1,$2,$3,$4)`,
      [id, variant, `inline:${variant}`, r.bytes],
    )

    const label = variant === 'ats' ? 'ATS' : 'CV'
    const safeTitle = (rows[0]!.title ?? 'CV')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/gi, 'd')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')

    return new NextResponse(new Uint8Array(r.pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        // Tên file ASCII cho tương thích, kèm filename* UTF-8 cho trình duyệt mới
        'Content-Disposition': `attachment; filename="${safeTitle}-${label}.pdf"`,
        'Content-Length': String(r.bytes),
        'X-Export-Ms': String(r.ms),
      },
    })
  } catch (err) {
    // Không giao file rỗng cho user — thà báo lỗi rõ ràng
    return NextResponse.json(
      { error: `Không tạo được PDF: ${(err as Error).message}` },
      { status: 500 },
    )
  }
}
