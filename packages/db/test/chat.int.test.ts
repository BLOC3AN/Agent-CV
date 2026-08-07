import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import { ProfileSchema, type Profile } from '@hr/schema'
import { ProfileRepo } from '../src/profiles.js'
import { ChatRepo } from '../src/chat.js'

/**
 * `recentMessages` phải trả về tin nhắn MỚI NHẤT — TDD §8.3.8.
 *
 * `ORDER BY created_at LIMIT n` lấy n tin nhắn CŨ NHẤT. Tên hàm nói "recent",
 * SQL làm ngược lại, và không có gì báo lỗi: phiên ngắn thì hai cách cho cùng
 * kết quả, nên nó chạy đúng suốt cho tới khi phiên dài ra.
 *
 * Chạy: npm run test:int
 */

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ?? 'postgres://postgres:hragent_dev@localhost:5433/hragent',
})
const repo = new ChatRepo(pool)
let userId: string
let profileId: string
let sessionId: string

const base = (): Profile =>
  ProfileSchema.parse({
    schemaVersion: 1,
    language: 'vi',
    basics: { name: 'Lê Thị Thu Hà' },
    work: [{ org: 'ABC', role: 'Thực tập sinh', highlights: ['Làm đồ án'] }],
  })

beforeAll(async () => {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ($1)
     ON CONFLICT (email) DO UPDATE SET locale = EXCLUDED.locale RETURNING id`,
    [`chat-${Date.now()}@example.com`],
  )
  userId = rows[0]!.id
  profileId = (await new ProfileRepo(pool).create(userId, base())).id
  sessionId = await repo.openSession(userId, profileId)
}, 30_000)

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE id = $1', [userId])
  await pool.end()
})

describe('recentMessages', () => {
  it('trả về n tin nhắn MỚI NHẤT, theo thứ tự thời gian', async () => {
    const ids: string[] = []
    for (let i = 0; i < 20; i++) {
      ids.push(await repo.addMessage({ sessionId, role: 'user', content: `tin ${i}` }))
    }

    const got = await repo.recentMessages(sessionId, 5)
    expect(got.map((m) => m.content)).toEqual(['tin 15', 'tin 16', 'tin 17', 'tin 18', 'tin 19'])
  })

  it('câu VỪA GÕ luôn nằm trong ngữ cảnh, dù phiên đã dài', async () => {
    // Đây là thiệt hại thật: `messageIds` dựng từ đây: thiếu câu hiện tại thì
    // mọi dẫn nguồn tới nó đều bị coi là bịa, và hồ sơ 84 tin nhắn chỉ còn
    // được model nhìn thấy phần đầu phiên.
    const last = await repo.addMessage({ sessionId, role: 'user', content: 'câu vừa gõ' })
    const got = await repo.recentMessages(sessionId, 12)

    expect(got.map((m) => m.id)).toContain(last)
    expect(got.at(-1)!.content).toBe('câu vừa gõ')
  })

  it('phiên ngắn hơn `limit` thì trả đủ, đúng thứ tự', async () => {
    const s2 = await repo.createSession({ userId, profileId, jdId: null })
    await repo.addMessage({ sessionId: s2, role: 'user', content: 'một' })
    await repo.addMessage({ sessionId: s2, role: 'assistant', content: 'hai' })

    const got = await repo.recentMessages(s2, 12)
    expect(got.map((m) => m.content)).toEqual(['một', 'hai'])
  })
})
