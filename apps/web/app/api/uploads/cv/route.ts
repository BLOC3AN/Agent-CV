import { NextResponse } from 'next/server'
import { getPool } from '@hr/db'
import { contentKey } from '@hr/worker/storage'
import { enqueue, storage } from '@/lib/jobs'

/**
 * POST /api/uploads/cv — UC-21, TDD §8.1 bước [0].
 *
 * Nhận file, lưu, đẩy job vào hàng đợi, trả `jobId` NGAY. Không parse ở đây:
 * parse tốn ~30-90s trên model server 4 slot, giữ kết nối HTTP lâu như vậy sẽ
 * đổ vỡ ngay khi có người thứ hai.
 */

export const dynamic = 'force-dynamic'

const MAX_BYTES = 12 * 1024 * 1024

export async function POST(req: Request) {
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Yêu cầu phải là multipart/form-data' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Thiếu file' }, { status: 400 })
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'File rỗng' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File vượt ${MAX_BYTES / 1024 / 1024}MB` },
      { status: 413 },
    )
  }

  const bytes = new Uint8Array(await file.arrayBuffer())

  // Nhận diện bằng NỘI DUNG, không tin phần mở rộng — CV-09 trong bộ eval là
  // ảnh đổi đuôi thành .pdf, người dùng thật cũng hay làm vậy.
  if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
    return NextResponse.json(
      { error: 'File không phải PDF. Bạn xuất CV ra PDF rồi tải lên lại giúp nhé.' },
      { status: 415 },
    )
  }

  // TODO(X-1 Auth): lấy userId từ session thay vì body
  const userId = form.get('userId')
  if (typeof userId !== 'string' || !userId) {
    return NextResponse.json({ error: 'Thiếu userId' }, { status: 400 })
  }
  const { rows } = await getPool().query('SELECT 1 FROM users WHERE id = $1', [userId])
  if (rows.length === 0) return NextResponse.json({ error: 'Không có user' }, { status: 404 })

  const key = contentKey(bytes)
  await storage().put(key, bytes)

  const lang = form.get('language')
  const r = await enqueue({
    userId,
    kind: 'parse_cv',
    // BR-72.1: cùng người + cùng nội dung file → cùng job, không parse lại.
    // Có userId trong khoá để hai người tải cùng một file vẫn có job riêng.
    idempotencyKey: `parse_cv:${userId}:${key}`,
    payload: {
      storageKey: key,
      filename: file.name,
      outputLanguage: lang === 'en' ? 'en' : 'vi',
    },
  })

  return NextResponse.json(
    {
      jobId: r.jobId,
      // `reused` = job cũ còn dùng được (đang chạy hoặc đã xong).
      // `revived` = job cũ THẤT BẠI, đã đưa lại vào hàng đợi để thử lại.
      reused: !r.created,
      revived: r.revived,
      // Redis chết thì job vẫn nằm ở `queued` — nói thật thay vì giả vờ xong
      queued: r.queued,
    },
    { status: r.created ? 202 : 200 },
  )
}
