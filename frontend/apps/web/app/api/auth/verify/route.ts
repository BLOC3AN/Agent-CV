import { NextResponse } from 'next/server'
import { authRepo, startSession } from '@/lib/auth'

/**
 * GET /api/auth/verify?token=… — đổi magic link lấy phiên (UC-11 bước 3-4).
 *
 * Ba lý do hỏng được phân biệt rõ thay vì gộp thành "link không hợp lệ": mỗi
 * lý do cần một hành động khác nhau từ người dùng.
 */

export const dynamic = 'force-dynamic'

const REASON: Record<string, string> = {
  not_found: 'Link này không đúng. Bạn xin link mới giúp nhé.',
  expired: 'Link đã hết hạn sau 15 phút. Bạn xin link mới giúp nhé.',
  used: 'Link này đã dùng rồi. Mỗi link chỉ dùng được một lần.',
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token')
  const base = process.env.APP_URL ?? 'http://localhost:3100'
  if (!token) return NextResponse.redirect(`${base}/login?error=${encodeURIComponent(REASON['not_found']!)}`)

  const r = await authRepo().consumeLoginToken(token)
  if (!r.ok) {
    return NextResponse.redirect(`${base}/login?error=${encodeURIComponent(REASON[r.reason]!)}`)
  }

  await startSession(r.user.id, req.headers.get('user-agent') ?? undefined)
  return NextResponse.redirect(base)
}
