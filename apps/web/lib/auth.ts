import 'server-only'
import { cookies } from 'next/headers'
import { AuthRepo, getPool, type SessionUser } from '@hr/db'

/**
 * Phiên đăng nhập ở tầng web — UC-11/12/13, X-1.
 *
 * ── Vì sao gom vào một chỗ ──
 * Trước đây mỗi route tự gọi `devUserId()`. Một route quên kiểm sẽ lặng lẽ gán
 * mọi hồ sơ vào cùng một tài khoản, và không ai phát hiện cho tới khi hai người
 * dùng thấy CV của nhau. Đi qua một cửa duy nhất thì "quên kiểm" thành lỗi biên
 * dịch, không phải lỗi âm thầm.
 */

export const SESSION_COOKIE = 'hr_session'

const g = globalThis as unknown as { __hrAuth?: AuthRepo }
export function authRepo(): AuthRepo {
  if (!g.__hrAuth) g.__hrAuth = new AuthRepo(getPool())
  return g.__hrAuth
}

/**
 * Tài khoản chạy thử cục bộ — CHỈ khi `ALLOW_DEV_USER=true`.
 *
 * Giữ lại sau khi có auth thật vì luồng kiểm thử tích hợp và script dev cần một
 * người dùng ổn định. Biến riêng chứ không dùng `NODE_ENV`: `NODE_ENV` cũng là
 * `production` khi chạy `next start` để thử tay, nên dựa vào nó thì hoặc chặn
 * luôn việc chạy thử, hoặc mở toang ở production thật.
 */
const DEV_EMAIL = 'dev@local'

async function devUser(): Promise<SessionUser | null> {
  if (process.env.ALLOW_DEV_USER !== 'true') return null
  return authRepo().upsertUser(DEV_EMAIL)
}

/** Người dùng hiện tại, hoặc `null` nếu chưa đăng nhập. */
export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (token) {
    const user = await authRepo().userOfSession(token)
    if (user) return user
  }
  // Phiên hỏng/hết hạn thì rơi về tài khoản dev nếu đang bật — để `npm run dev`
  // không phải đăng nhập lại sau mỗi lần dọn DB.
  return devUser()
}

export class NotAuthenticated extends Error {
  constructor() {
    super('Bạn cần đăng nhập để dùng tính năng này.')
    this.name = 'NotAuthenticated'
  }
}

/**
 * Người dùng hiện tại, NÉM LỖI nếu chưa đăng nhập.
 *
 * Dùng ở mọi route API chạm dữ liệu người dùng. Ném thay vì trả `null` để chỗ
 * gọi không thể vô tình đi tiếp với `userId === undefined`.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser()
  if (!user) throw new NotAuthenticated()
  return user
}

/** `userId` — dạng gọn cho các route chỉ cần khoá. */
export async function requireUserId(): Promise<string> {
  return (await requireUser()).id
}

export async function startSession(userId: string, userAgent?: string): Promise<void> {
  const { token, expiresAt } = await authRepo().createSession(userId, userAgent)
  ;(await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    // `secure` theo APP_URL chứ không theo NODE_ENV: chạy thử tay qua http vẫn
    // là NODE_ENV=production, và cookie `secure` sẽ không bao giờ được gửi đi.
    secure: (process.env.APP_URL ?? '').startsWith('https://'),
    path: '/',
    expires: expiresAt,
  })
}

export async function endSession(): Promise<void> {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (token) await authRepo().destroySession(token)
  jar.delete(SESSION_COOKIE)
}
