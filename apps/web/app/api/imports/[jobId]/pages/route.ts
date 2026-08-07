import { NextResponse } from 'next/server'
import { PdfkitClient } from '@hr/worker/pdfkit'
import { jobRepo, storage } from '@/lib/jobs'

/**
 * GET /api/imports/:jobId/pages — ảnh trang PDF gốc + toạ độ khối text.
 *
 * Dùng cho cột trái của màn hình rà soát (UC-22 bước 2): user bấm vào một field
 * bên phải thì vùng tương ứng trên ảnh được tô sáng.
 *
 * Render theo yêu cầu chứ không lưu sẵn lúc parse: ảnh nặng hơn cả file PDF
 * gốc, mà phần lớn user chỉ rà soát một lần rồi không quay lại.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** 110 dpi: đủ nét để đọc đối chiếu trên màn hình, ảnh không quá nặng. */
const DPI = 110
const MAX_PAGES = 5

export async function GET(req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params

  const job = await jobRepo().get(jobId)
  if (!job) return NextResponse.json({ error: 'Không tìm thấy job' }, { status: 404 })

  const key = (job.payload as { storageKey?: string }).storageKey
  if (!key) return NextResponse.json({ error: 'Job không có file gốc' }, { status: 404 })

  let pdf: Uint8Array
  try {
    pdf = await storage().get(key)
  } catch {
    // File gốc bị dọn sau 48 giờ (TDD §15.2 R3) — không phải lỗi, chỉ là hết
    // hạn. Màn hình rà soát vẫn dùng được, chỉ mất phần đối chiếu ảnh.
    return NextResponse.json({ expired: true, pages: [], blocks: [] })
  }

  const client = new PdfkitClient()
  const wantBlocks = new URL(req.url).searchParams.get('blocks') !== 'false'

  try {
    const [rendered, extracted] = await Promise.all([
      client.render(pdf, { dpi: DPI, maxPages: MAX_PAGES }),
      wantBlocks ? client.extract(pdf, 'cv.pdf', true) : Promise.resolve(null),
    ])

    return NextResponse.json({
      expired: false,
      dpi: DPI,
      // Hệ toạ độ của khối text là point (72 dpi) của PyMuPDF, còn ảnh render ở
      // DPI khác. FE cần tỉ lệ này để vẽ khung đúng chỗ.
      scale: DPI / 72,
      pages: rendered.pages,
      blocks: extracted?.blocks ?? [],
    })
  } catch (err) {
    return NextResponse.json(
      { error: `Không dựng được ảnh trang: ${(err as Error).message}` },
      { status: 502 },
    )
  }
}
