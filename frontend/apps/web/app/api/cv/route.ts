import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getPool, jsonb, ProfileRepo } from '@hr/db'
import { ProfileSchema } from '@hr/schema'
import { NotAuthenticated, requireUser } from '@/lib/auth'

/**
 * POST /api/cv — tạo CV bằng cách NHẬP TAY (UC-23, X-6).
 *
 * Lối vào thứ hai vào cùng một `Profile`, ngang hàng với import PDF (BR-01.1).
 * Người chưa có CV nào phải làm được việc này mà không cần một file để tải lên.
 */
export const dynamic = 'force-dynamic'

const Body = z.object({
  name: z.string().min(1, 'Bạn cần điền họ tên'),
  headline: z.string().optional(),
  email: z.string().email('Email không hợp lệ').optional().or(z.literal('')),
  phone: z.string().optional(),
  language: z.enum(['vi', 'en']).default('vi'),
  /**
   * Câu trả lời từ luồng có người dẫn (UC-05) — tuỳ chọn.
   *
   * Cùng một endpoint cho cả nhập tay lẫn luồng có người dẫn: hai lối vào đó
   * ra CÙNG một `Profile` (BR-01.1), khác nhau chỉ ở chỗ hỏi bao nhiêu câu.
   */
  guided: z
    .object({
      hasWorked: z.boolean().optional(),
      bodyTitle: z.string().optional(),
      bodyOrg: z.string().optional(),
      bodyHighlight: z.string().optional(),
    })
    .optional(),
})

/** Mục chính từ luồng có người dẫn: kinh nghiệm HOẶC dự án, tuỳ câu trả lời. */
function bodyFrom(g: NonNullable<z.infer<typeof Body>['guided']>) {
  const title = g.bodyTitle?.trim()
  if (!title) return {}
  const highlights = g.bodyHighlight?.trim() ? [g.bodyHighlight.trim()] : []

  // Chưa đi làm thì nội dung vào DỰ ÁN, không phải để trống mục kinh nghiệm
  // (BR-05.2): với sinh viên, dự án mới là phần nhà tuyển dụng đọc kỹ.
  if (g.hasWorked === false) {
    return { projects: [{ name: title, tech: [], highlights }] }
  }
  return { work: [{ org: g.bodyOrg?.trim() || title, role: title, highlights }] }
}

export async function POST(req: Request) {
  let user
  try {
    user = await requireUser()
  } catch (e) {
    if (e instanceof NotAuthenticated) return NextResponse.json({ error: e.message }, { status: 401 })
    throw e
  }

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ' },
      { status: 400 },
    )
  }
  const b = parsed.data

  const profile = ProfileSchema.parse({
    schemaVersion: 1,
    language: b.language,
    basics: {
      name: b.name.trim(),
      ...(b.headline?.trim() ? { headline: b.headline.trim() } : {}),
      ...(b.email?.trim() ? { email: b.email.trim() } : {}),
      ...(b.phone?.trim() ? { phone: b.phone.trim() } : {}),
    },
    ...(b.guided ? bodyFrom(b.guided) : {}),
    // Nhập tay thì mọi field là do NGƯỜI dùng gõ, nên đã xác nhận sẵn — khác
    // hẳn import PDF, nơi model đọc ra và bắt buộc phải rà soát (UC-22).
    _meta: { source: 'manual', verified: {} },
  })

  const created = await new ProfileRepo(getPool()).create(user.id, profile)
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO cv_documents (user_id, profile_id, profile_snapshot, title, language)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [user.id, created.id, jsonb(profile), profile.basics.name, profile.language],
  )

  return NextResponse.json({ cvId: rows[0]!.id, profileId: created.id }, { status: 201 })
}
