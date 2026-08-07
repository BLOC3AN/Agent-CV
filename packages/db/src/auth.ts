import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Pool } from 'pg'

/**
 * Phiên đăng nhập & magic link — UC-11, BR-11.1.
 *
 * ── Vì sao lưu phiên ở DB chứ không chỉ ký JWT ──
 * Đăng xuất phải có hiệu lực NGAY. JWT tự chứa thì chỉ hết hạn theo thời gian:
 * một token bị lộ vẫn dùng được cho tới lúc hết hạn, và người dùng bấm "đăng
 * xuất" ở máy công cộng vẫn để lại một phiên sống. Không chấp nhận được với dữ
 * liệu chứa PII (TDD §15).
 *
 * ── Vì sao lưu BĂM của token ──
 * Bảng này chỉ giữ `sha256(token)`. Rò cả bảng ra ngoài cũng không đăng nhập
 * được vào tài khoản nào — cùng lý do như lưu mật khẩu đã băm.
 */

const SESSION_DAYS = 30
const LOGIN_TOKEN_MINUTES = 15

/** 32 byte ngẫu nhiên, base64url — đủ dài để không dò được. */
export function newToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * So sánh hai chuỗi trong thời gian KHÔNG phụ thuộc nội dung.
 *
 * So bằng `===` để lộ vị trí ký tự đầu tiên khác nhau qua thời gian chạy; với
 * token thì đó là một kênh dò từng byte một.
 */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  if (x.length !== y.length) return false
  return timingSafeEqual(x, y)
}

export interface SessionUser {
  id: string
  email: string
  locale: string
}

export class AuthRepo {
  constructor(private readonly pool: Pool) {}

  /**
   * Tạo magic link. Trả về token THÔ — chỉ chỗ gọi thấy, để gửi qua email.
   *
   * KHÔNG tạo user ở bước này: ai cũng gõ được một email bất kỳ vào ô đăng
   * nhập, và tạo user cho mỗi lần gõ sẽ để người lạ làm đầy bảng `users`.
   * User chỉ ra đời khi link được bấm (`consumeLoginToken`).
   */
  async createLoginToken(email: string): Promise<{ token: string; expiresAt: Date }> {
    const token = newToken()
    const expiresAt = new Date(Date.now() + LOGIN_TOKEN_MINUTES * 60_000)
    await this.pool.query(
      'INSERT INTO login_tokens (token_hash, email, expires_at) VALUES ($1, $2, $3)',
      [hashToken(token), email.trim().toLowerCase(), expiresAt],
    )
    return { token, expiresAt }
  }

  /**
   * Đổi magic link lấy user. Dùng MỘT LẦN.
   *
   * Phân biệt ba trường hợp thay vì gộp thành "link không hợp lệ": người dùng
   * cần biết mình phải làm gì tiếp, và ba trường hợp này cần ba hành động khác
   * nhau (gửi lại / bấm link mới nhất / kiểm lại email).
   */
  async consumeLoginToken(
    token: string,
  ): Promise<
    | { ok: true; user: SessionUser }
    | { ok: false; reason: 'not_found' | 'expired' | 'used' }
  > {
    const hash = hashToken(token)
    const { rows } = await this.pool.query<{
      email: string
      expires_at: Date
      used_at: Date | null
    }>('SELECT email, expires_at, used_at FROM login_tokens WHERE token_hash = $1', [hash])

    const row = rows[0]
    if (!row) return { ok: false, reason: 'not_found' }
    if (row.used_at) return { ok: false, reason: 'used' }
    if (row.expires_at.getTime() < Date.now()) return { ok: false, reason: 'expired' }

    // Đánh dấu đã dùng TRƯỚC khi tạo user: hai tab bấm cùng lúc thì chỉ một tab
    // đi tiếp được. `used_at IS NULL` trong WHERE là chốt chặn nguyên tử.
    const claimed = await this.pool.query(
      'UPDATE login_tokens SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL',
      [hash],
    )
    if (claimed.rowCount === 0) return { ok: false, reason: 'used' }

    const user = await this.upsertUser(row.email)
    return { ok: true, user }
  }

  /** Email là định danh duy nhất, không phân biệt hoa thường — BR-11.1 (`citext`). */
  async upsertUser(email: string, locale = 'vi'): Promise<SessionUser> {
    const { rows } = await this.pool.query<{ id: string; email: string; locale: string }>(
      `INSERT INTO users (email, locale) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING id, email::text AS email, locale`,
      [email.trim().toLowerCase(), locale],
    )
    return rows[0]!
  }

  async createSession(userId: string, userAgent?: string): Promise<{ token: string; expiresAt: Date }> {
    const token = newToken()
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000)
    await this.pool.query(
      'INSERT INTO sessions (token_hash, user_id, expires_at, user_agent) VALUES ($1,$2,$3,$4)',
      [hashToken(token), userId, expiresAt, userAgent ?? null],
    )
    return { token, expiresAt }
  }

  /** Người dùng của một phiên, hoặc `null` nếu phiên không còn hiệu lực. */
  async userOfSession(token: string): Promise<SessionUser | null> {
    const { rows } = await this.pool.query<{ id: string; email: string; locale: string }>(
      `SELECT u.id, u.email::text AS email, u.locale
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now() AND u.deleted_at IS NULL`,
      [hashToken(token)],
    )
    const user = rows[0]
    if (!user) return null

    // Chạm nhẹ để biết phiên nào còn dùng — phục vụ dọn phiên chết, không phải
    // để gia hạn: gia hạn tự động làm phiên bị lộ sống mãi.
    void this.pool
      .query('UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1', [hashToken(token)])
      .catch(() => {})

    return user
  }

  async destroySession(token: string): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)])
  }

  /** Đăng xuất khỏi MỌI thiết bị — dùng sau khi đổi email hoặc nghi bị lộ. */
  async destroyAllSessions(userId: string): Promise<number> {
    const r = await this.pool.query('DELETE FROM sessions WHERE user_id = $1', [userId])
    return r.rowCount ?? 0
  }

  /**
   * Xoá tài khoản — UC-13, BR-13.1 xoá cứng, không soft-delete.
   *
   * Mọi bảng dữ liệu người dùng đều `ON DELETE CASCADE` từ `users`, nên xoá một
   * dòng là sạch. `llm_calls` giữ lại nhưng vốn không chứa nội dung
   * (TDD §15.2 R6) — nó là số liệu vận hành, không phải dữ liệu cá nhân.
   */
  async deleteAccount(userId: string): Promise<void> {
    await this.pool.query('DELETE FROM users WHERE id = $1', [userId])
  }

  /** Dọn token và phiên đã hết hạn. Trả về số dòng đã xoá. */
  async purgeExpired(): Promise<number> {
    const a = await this.pool.query('DELETE FROM sessions WHERE expires_at < now()')
    const b = await this.pool.query(
      "DELETE FROM login_tokens WHERE expires_at < now() - interval '1 day'",
    )
    return (a.rowCount ?? 0) + (b.rowCount ?? 0)
  }
}
