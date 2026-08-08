import { NextResponse } from 'next/server'
import { profileRepo } from '@/lib/db'

/**
 * GET /api/profiles/:id/revisions/:revisionId — XEM TRƯỚC một mốc lịch sử (UC-34).
 *
 * Tách khỏi `/revert`: xem là đọc, khôi phục là ghi và làm mất các mốc mới hơn.
 * Gộp hai việc buộc người dùng phải khôi phục mới biết mình khôi phục cái gì.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; revisionId: string }> },
) {
  const { id, revisionId } = await params

  // id là bigserial — chặn ở đây để Postgres không ném lỗi cú pháp thô ra FE
  if (!/^\d+$/.test(revisionId)) {
    return NextResponse.json({ error: 'revisionId không hợp lệ' }, { status: 400 })
  }

  const snap = await profileRepo().snapshotAt(id, revisionId)
  if (!snap) {
    return NextResponse.json({ error: 'Không có mốc lịch sử này' }, { status: 404 })
  }
  return NextResponse.json(snap)
}
