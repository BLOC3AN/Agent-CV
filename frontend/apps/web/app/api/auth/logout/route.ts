import { NextResponse } from 'next/server'
import { endSession } from '@/lib/auth'

/**
 * POST /api/auth/logout — huỷ phiên NGAY LẬP TỨC.
 *
 * Xoá dòng trong `sessions` chứ không chỉ xoá cookie: cookie đã bị sao chép
 * vẫn dùng được nếu phiên còn sống ở phía máy chủ.
 */
export async function POST() {
  await endSession()
  return NextResponse.json({ ok: true })
}
