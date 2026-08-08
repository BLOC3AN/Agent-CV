import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authRepo, endSession, requireUser } from '@/lib/auth'
import { NotAuthenticated } from '@/lib/auth'

/**
 * DELETE /api/account — xoá tài khoản và toàn bộ dữ liệu (UC-13).
 *
 * BR-13.1: xoá CỨNG, không soft-delete. Mọi bảng dữ liệu người dùng đều
 * `ON DELETE CASCADE` từ `users`.
 *
 * Bắt gõ lại email trước khi xoá (UC-13 bước 3): thao tác này không khôi phục
 * được, nên một cú bấm nhầm không được phép đủ để thực hiện nó.
 */
export async function DELETE(req: Request) {
  let user
  try {
    user = await requireUser()
  } catch (e) {
    if (e instanceof NotAuthenticated) return NextResponse.json({ error: e.message }, { status: 401 })
    throw e
  }

  const Body = z.object({ confirmEmail: z.string() })
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Thiếu xác nhận' }, { status: 400 })

  if (parsed.data.confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()) {
    return NextResponse.json(
      { error: 'Email xác nhận không khớp với tài khoản đang đăng nhập.' },
      { status: 400 },
    )
  }

  await authRepo().deleteAccount(user.id)
  await endSession()
  return NextResponse.json({ ok: true })
}
