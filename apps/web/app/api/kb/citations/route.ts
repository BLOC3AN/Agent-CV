import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getPool } from '@hr/db'
import { SqlFilterSelector } from '@hr/kb'

/**
 * POST /api/kb/citations — trích dẫn cho các đoạn tri thức đã dùng (UC-63, §10.4).
 *
 * Giao diện hiển thị "Theo [Tên] — [Chức danh]" kèm trích đoạn gốc. Lời khuyên
 * không có trích dẫn được gắn nhãn "gợi ý chung của AI" và hiện khác màu.
 */

export const dynamic = 'force-dynamic'

// Nhận CẢ mã người đọc được (`g_bullet_formula`) lẫn UUID: model trích mã
// ngắn, code nội bộ dùng UUID. Ép một dạng sẽ làm trích dẫn im lặng biến mất.
const Body = z.object({
  chunkIds: z.array(z.string().min(1).max(80)).max(50),
  language: z.enum(['vi', 'en']).default('vi'),
})

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Body không hợp lệ' }, { status: 400 })
  }
  const citations = await new SqlFilterSelector(getPool()).citations(
    parsed.data.chunkIds,
    parsed.data.language,
  )
  return NextResponse.json({ citations })
}
