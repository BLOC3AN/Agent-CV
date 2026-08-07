import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import { MatchRepo } from '../src/matching.js'
import { jsonb } from '../src/pool.js'

/**
 * `latestForProfile` phải TRẢ VỀ DỮ LIỆU — TDD §8.3.5, BR-56.2.
 *
 * ── Vì sao test này tồn tại ──
 * Câu truy vấn viết `j.title`, mà `job_descriptions` không có cột đó — tên tin
 * nằm trong `requirements`. Chỗ gọi bọc `.catch(() => null)`, nên lỗi SQL này
 * IM LẶNG hoàn toàn: trợ lý tưởng là chưa có kết quả đối chiếu nào và trả lời
 * chung chung, đúng thứ BR-56.2 cấm.
 *
 * TypeScript không bắt được: SQL là chuỗi. Chỉ chạm Postgres thật mới thấy.
 */

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ?? 'postgres://postgres:hragent_dev@localhost:5433/hragent',
})
const repo = new MatchRepo(pool)
let userId: string

beforeAll(async () => {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ($1)
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
    [`match-${Date.now()}@example.com`],
  )
  userId = rows[0]!.id
}, 30_000)

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE id = $1', [userId])
  await pool.end()
})

/** Dựng đủ chuỗi profile → cv → jd → match_analyses cho một phép đo thật. */
async function seed(): Promise<string> {
  const profile = { schemaVersion: 1, language: 'vi', basics: { name: 'Lê Văn Bình' } }
  const p = await pool.query<{ id: string }>(
    'INSERT INTO profiles (user_id, data) VALUES ($1,$2) RETURNING id',
    [userId, jsonb(profile)],
  )
  const profileId = p.rows[0]!.id

  const jd = await pool.query<{ id: string }>(
    `INSERT INTO job_descriptions (user_id, raw_text, requirements, industry, role_family, seniority)
     VALUES ($1,$2,$3,'it_software','backend_developer','junior') RETURNING id`,
    [userId, 'Tuyển Backend Developer', jsonb({ title: 'Backend Developer', hardSkills: ['Node.js'] })],
  )
  const cv = await pool.query<{ id: string }>(
    `INSERT INTO cv_documents (user_id, profile_id, profile_snapshot, title, language)
     VALUES ($1,$2,$3,'CV thử','vi') RETURNING id`,
    [userId, profileId, jsonb(profile)],
  )
  await repo.saveMatch({
    cvId: cv.rows[0]!.id,
    jdId: jd.rows[0]!.id,
    revisionId: null,
    result: {
      overall: 62,
      breakdown: { skills: 55, keywords: 40, experience: 30, education: 70, rubric: 60 },
      matched: [{ requirement: 'Node.js', evidence: '/skills/0' }],
      gaps: [{ requirement: 'Docker', severity: 'high', reason: 'không thấy trong CV' }],
      missingAtsKeywords: ['CI/CD'],
      degraded: false,
    } as never,
  })
  return profileId
}

describe('latestForProfile', () => {
  it('trả về kết quả đối chiếu THẬT, không phải null', async () => {
    const profileId = await seed()
    const r = await repo.latestForProfile(profileId)

    // Lỗi cũ: câu SQL sai cột nên ném lỗi, chỗ gọi nuốt thành `null`, và trợ lý
    // tưởng chưa từng đối chiếu gì
    expect(r, 'trả về null — câu truy vấn hỏng').not.toBeNull()
    expect(r!.overall).toBe(62)
    expect(r!.jdTitle).toBe('Backend Developer')
    expect(r!.matchedCount).toBe(1)
    expect(r!.gaps).toHaveLength(1)
    expect(r!.missingAtsKeywords).toContain('CI/CD')
  })

  it('hồ sơ chưa đối chiếu bao giờ → null, và đó là câu trả lời ĐÚNG', async () => {
    const p = await pool.query<{ id: string }>(
      'INSERT INTO profiles (user_id, data) VALUES ($1,$2) RETURNING id',
      [userId, jsonb({ schemaVersion: 1, language: 'vi', basics: { name: 'X' } })],
    )
    expect(await repo.latestForProfile(p.rows[0]!.id)).toBeNull()
  })
})
