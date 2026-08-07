import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authRepo } from '@/lib/auth'
import { sendLoginLink } from '@/lib/mailer'

/**
 * POST /api/auth/request — xin link đăng nhập (UC-11).
 *
 * KHÔNG tiết lộ email đã có tài khoản hay chưa: trả lời giống hệt nhau trong
 * cả hai trường hợp. Khác đi là biến ô đăng nhập thành công cụ dò xem một địa
 * chỉ có dùng dịch vụ này không.
 */

export const dynamic = 'force-dynamic'

const Body = z.object({ email: z.string().email('Email không hợp lệ') })

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Email không hợp lệ' },
      { status: 400 },
    )
  }

  const email = parsed.data.email.trim().toLowerCase()
  const base = process.env.APP_URL ?? 'http://localhost:3100'

  try {
    const { token } = await authRepo().createLoginToken(email)
    const link = `${base}/api/auth/verify?token=${encodeURIComponent(token)}`
    const r = await sendLoginLink(email, link)
    return NextResponse.json({ ok: true, sent: r.sent, devLink: r.devLink })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
