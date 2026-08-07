import { NextResponse } from 'next/server'
import { jobRepo, splitError } from '@/lib/jobs'

/**
 * GET    /api/jobs/:id — tra trạng thái (TDD §13)
 * DELETE /api/jobs/:id — huỷ job đang chờ (UC-72)
 */

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const job = await jobRepo().get(id)
  if (!job) return NextResponse.json({ error: 'Không tìm thấy job' }, { status: 404 })

  return NextResponse.json({
    id: job.id,
    kind: job.kind,
    status: job.status,
    attempts: job.attempts,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    result: job.result,
    // Tách mã ra khỏi thông điệp: FE rẽ nhánh theo `code` (ví dụ NO_TEXT_LAYER
    // → mời nhập tay) chứ không đoán ý bằng cách so khớp tiếng Việt (BR-71.1).
    error: splitError(job.error),
  })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const job = await jobRepo().get(id)
  if (!job) return NextResponse.json({ error: 'Không tìm thấy job' }, { status: 404 })

  const cancelled = await jobRepo().cancel(id)
  if (!cancelled) {
    return NextResponse.json(
      { error: `Job đã ${job.status}, không huỷ được nữa`, status: job.status },
      { status: 409 },
    )
  }
  return NextResponse.json({ id, status: 'cancelled' })
}
