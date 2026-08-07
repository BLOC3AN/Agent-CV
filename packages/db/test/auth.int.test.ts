import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import { AuthRepo, hashToken, newToken, safeEqual } from '../src/auth.js'

/**
 * TC-11-*, TC-13-* — phiên đăng nhập & xoá tài khoản. UC-11/13, X-1.
 *
 * Trước X-1, mọi thứ chạy trên một tài khoản dev: hai người vào cùng lúc thấy
 * chung hồ sơ của nhau. Đó là lỗi PII, không phải lỗi tính năng.
 *
 *   npm run test:int
 */

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ?? 'postgres://postgres:hragent_dev@localhost:5433/hragent',
})
const repo = new AuthRepo(pool)
const emails: string[] = []

function freshEmail(tag: string): string {
  const e = `auth-${tag}-${Math.floor(performance.now() * 1000)}@example.com`
  emails.push(e)
  return e
}

beforeAll(async () => {
  await pool.query('SELECT 1')
}, 30_000)

afterAll(async () => {
  if (emails.length) await pool.query('DELETE FROM users WHERE email = ANY($1)', [emails])
  await pool.query('DELETE FROM login_tokens WHERE email = ANY($1)', [emails])
  await pool.end()
})

describe('token', () => {
  it('mỗi lần sinh ra một token khác nhau', () => {
    expect(newToken()).not.toBe(newToken())
    expect(newToken().length).toBeGreaterThan(20)
  })

  it('băm ổn định và KHÔNG lộ token gốc', () => {
    const t = newToken()
    expect(hashToken(t)).toBe(hashToken(t))
    expect(hashToken(t)).not.toContain(t)
  })

  it('so sánh an toàn không phụ thuộc độ dài', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'abcd')).toBe(false)
  })
})

describe('magic link — UC-11', () => {
  it('đổi link lấy user, và TẠO user nếu chưa có', async () => {
    const email = freshEmail('new')
    const { token } = await repo.createLoginToken(email)

    const r = await repo.consumeLoginToken(token)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.user.email).toBe(email)
  })

  it('TC-11-01 link chỉ dùng được MỘT lần', async () => {
    const { token } = await repo.createLoginToken(freshEmail('once'))
    expect((await repo.consumeLoginToken(token)).ok).toBe(true)

    const again = await repo.consumeLoginToken(token)
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.reason).toBe('used')
  })

  it('link hết hạn bị từ chối, và nói RÕ là hết hạn', async () => {
    const email = freshEmail('exp')
    const { token } = await repo.createLoginToken(email)
    await pool.query(
      "UPDATE login_tokens SET expires_at = now() - interval '1 minute' WHERE token_hash = $1",
      [hashToken(token)],
    )

    const r = await repo.consumeLoginToken(token)
    expect(r.ok).toBe(false)
    // Ba lý do phân biệt được: mỗi lý do cần một hành động khác từ người dùng
    if (!r.ok) expect(r.reason).toBe('expired')
  })

  it('token bịa ra → not_found, không phải lỗi hệ thống', async () => {
    const r = await repo.consumeLoginToken(newToken())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('not_found')
  })

  it('BR-11.1 email không phân biệt hoa thường', async () => {
    const email = freshEmail('case')
    const a = await repo.upsertUser(email.toUpperCase())
    const b = await repo.upsertUser(email.toLowerCase())
    expect(a.id).toBe(b.id)
  })
})

describe('phiên đăng nhập', () => {
  it('phiên hợp lệ trả về đúng user', async () => {
    const user = await repo.upsertUser(freshEmail('sess'))
    const { token } = await repo.createSession(user.id)
    expect((await repo.userOfSession(token))?.id).toBe(user.id)
  })

  it('đăng xuất có hiệu lực NGAY', async () => {
    // Đây là lý do phiên nằm ở DB chứ không phải JWT tự chứa
    const user = await repo.upsertUser(freshEmail('out'))
    const { token } = await repo.createSession(user.id)
    await repo.destroySession(token)
    expect(await repo.userOfSession(token)).toBeNull()
  })

  it('phiên hết hạn không dùng được', async () => {
    const user = await repo.upsertUser(freshEmail('old'))
    const { token } = await repo.createSession(user.id)
    await pool.query("UPDATE sessions SET expires_at = now() - interval '1 day' WHERE token_hash = $1", [
      hashToken(token),
    ])
    expect(await repo.userOfSession(token)).toBeNull()
  })

  it('đăng xuất mọi thiết bị', async () => {
    const user = await repo.upsertUser(freshEmail('all'))
    const a = await repo.createSession(user.id)
    const b = await repo.createSession(user.id)
    expect(await repo.destroyAllSessions(user.id)).toBe(2)
    expect(await repo.userOfSession(a.token)).toBeNull()
    expect(await repo.userOfSession(b.token)).toBeNull()
  })

  it('token bịa ra không mở được phiên nào', async () => {
    expect(await repo.userOfSession(newToken())).toBeNull()
  })
})

describe('TC-13-* xoá tài khoản — UC-13', () => {
  it('BR-13.1 xoá CỨNG, kéo theo mọi dữ liệu', async () => {
    const user = await repo.upsertUser(freshEmail('del'))
    await pool.query(
      `INSERT INTO profiles (user_id, data) VALUES ($1, $2)`,
      [user.id, JSON.stringify({ schemaVersion: 1, language: 'vi', basics: { name: 'X' } })],
    )
    const { token } = await repo.createSession(user.id)

    await repo.deleteAccount(user.id)

    const u = await pool.query('SELECT 1 FROM users WHERE id = $1', [user.id])
    const p = await pool.query('SELECT 1 FROM profiles WHERE user_id = $1', [user.id])
    expect(u.rowCount).toBe(0)
    expect(p.rowCount).toBe(0)
    // Phiên cũng phải chết theo — cookie còn trong trình duyệt không được dùng lại
    expect(await repo.userOfSession(token)).toBeNull()
  })
})
