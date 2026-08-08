import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import pg from 'pg'
import { ProfileSchema, type Profile, type PatchOp } from '@hr/schema'
import { ProfileRepo } from '../src/profiles.js'

/**
 * Test tích hợp — CHẠM POSTGRES THẬT.
 * Cần: docker compose up -d postgres && npm run db:migrate
 * Chạy: npm run test:int
 */

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ?? 'postgres://postgres:hragent_dev@localhost:5433/hragent',
})
const repo = new ProfileRepo(pool)
let userId: string

const base = (): Profile =>
  ProfileSchema.parse({
    schemaVersion: 1,
    language: 'vi',
    basics: { name: 'Nguyễn Minh Khôi', headline: 'Backend Developer' },
    work: [{ org: 'ABC', role: 'Thực tập sinh', highlights: ['Làm đồ án'] }],
    skills: [{ name: 'Node.js' }],
  })

const op = (o: Partial<PatchOp> & Pick<PatchOp, 'op' | 'path'>): PatchOp =>
  ({
    rationale: 'lý do đủ dài để qua schema',
    grounding: { type: 'user_message', ref: 'msg_1' },
    kbRefs: [],
    ...o,
  }) as PatchOp

beforeAll(async () => {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ($1)
     ON CONFLICT (email) DO UPDATE SET locale = EXCLUDED.locale RETURNING id`,
    [`test-${Date.now()}@example.com`],
  )
  userId = rows[0]!.id
})

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE id = $1', [userId])
  await pool.end()
})

let profileId: string
beforeEach(async () => {
  const r = await repo.create(userId, base())
  profileId = r.id
})

describe('ProfileRepo — CRUD', () => {
  it('tạo và đọc lại đúng', async () => {
    const p = await repo.get(profileId)
    expect(p?.basics.name).toBe('Nguyễn Minh Khôi')
    expect(p?.work).toHaveLength(1)
  })

  it('id không tồn tại → null, không ném lỗi', async () => {
    expect(await repo.get('00000000-0000-0000-0000-000000000000')).toBeNull()
  })
})

describe('patch() — ghi kèm revision', () => {
  it('áp patch và tạo revision', async () => {
    const r = await repo.patch(
      profileId,
      [op({ op: 'replace', path: '/basics/headline', value: 'Fullstack Developer' })],
      'user',
    )
    expect(r.profile.basics.headline).toBe('Fullstack Developer')
    expect(r.applied).toHaveLength(1)

    const revs = await repo.revisions(profileId)
    expect(revs).toHaveLength(1)
    expect(revs[0]!.author).toBe('user')
  })

  it('TC-53-08 — AI sửa thì verified=false, user sửa thì true', async () => {
    const ai = await repo.patch(
      profileId,
      [op({ op: 'replace', path: '/basics/headline', value: 'AI viết' })],
      'ai',
      undefined,
    )
    expect(ai.profile._meta.verified['/basics/headline']).toBe(false)

    const user = await repo.patch(
      profileId,
      [op({ op: 'replace', path: '/basics/headline', value: 'User sửa' })],
      'user',
    )
    expect(user.profile._meta.verified['/basics/headline']).toBe(true)
  })

  it('TC-53-05 — áp dụng một phần: op sai bị bỏ, op đúng vẫn ghi', async () => {
    const r = await repo.patch(
      profileId,
      [
        op({ op: 'replace', path: '/khong/ton/tai', value: 'x' }),
        op({ op: 'replace', path: '/basics/headline', value: 'OK' }),
      ],
      'ai',
    )
    expect(r.applied).toHaveLength(1)
    expect(r.rejected).toHaveLength(1)
    expect((await repo.get(profileId))!.basics.headline).toBe('OK')
  })

  it('toàn bộ op sai → ném lỗi và ROLLBACK, không tạo revision', async () => {
    await expect(
      repo.patch(profileId, [op({ op: 'remove', path: '/basics/name' })], 'ai'),
    ).rejects.toThrow(/Patch thất bại/)
    expect(await repo.revisions(profileId)).toHaveLength(0)
    expect((await repo.get(profileId))!.basics.name).toBe('Nguyễn Minh Khôi')
  })
})

describe('TC-54-02 — undo dùng chung cơ chế cho user và AI', () => {
  it('undo thay đổi của AI', async () => {
    await repo.patch(
      profileId,
      [op({ op: 'replace', path: '/basics/headline', value: 'AI đổi' })],
      'ai',
    )
    const back = await repo.undoLast(profileId)
    expect(back?.basics.headline).toBe('Backend Developer')
    expect(await repo.revisions(profileId)).toHaveLength(0)
  })

  it('undo thay đổi của user — CÙNG hàm, không cần cơ chế riêng', async () => {
    await repo.patch(
      profileId,
      [op({ op: 'replace', path: '/basics/headline', value: 'User đổi' })],
      'user',
    )
    const back = await repo.undoLast(profileId)
    expect(back?.basics.headline).toBe('Backend Developer')
  })

  it('không có gì để undo → null', async () => {
    expect(await repo.undoLast(profileId)).toBeNull()
  })

  it('TC-54-04 — undo được nhiều bước liên tiếp', async () => {
    for (const v of ['A', 'B', 'C']) {
      await repo.patch(
        profileId,
        [op({ op: 'replace', path: '/basics/headline', value: v })],
        'user',
      )
    }
    expect((await repo.get(profileId))!.basics.headline).toBe('C')
    await repo.undoLast(profileId)
    expect((await repo.get(profileId))!.basics.headline).toBe('B')
    await repo.undoLast(profileId)
    await repo.undoLast(profileId)
    expect((await repo.get(profileId))!.basics.headline).toBe('Backend Developer')
  })
})

describe('TC-54-05 — quay về một mốc bất kỳ', () => {
  it('revertTo khôi phục đúng trạng thái tại mốc đó', async () => {
    const r1 = await repo.patch(
      profileId,
      [op({ op: 'replace', path: '/basics/headline', value: 'V1' })],
      'user',
    )
    await repo.patch(
      profileId,
      [op({ op: 'replace', path: '/basics/headline', value: 'V2' })],
      'user',
    )
    await repo.patch(
      profileId,
      [op({ op: 'add', path: '/skills/-', value: { name: 'Docker' } })],
      'user',
    )
    expect((await repo.get(profileId))!.skills).toHaveLength(2)

    // Quay về TRƯỚC r1 → huỷ cả 3 thay đổi
    const back = await repo.revertTo(profileId, r1.revisionId)
    expect(back.basics.headline).toBe('Backend Developer')
    expect(back.skills).toHaveLength(1)
  })
})

describe('UC-34 — xem lại một mốc mà KHÔNG khôi phục', () => {
  it('dựng đúng hai phía của mốc và không ghi gì', async () => {
    const r1 = await repo.patch(
      profileId,
      [op({ op: 'replace', path: '/basics/headline', value: 'V1' })],
      'user',
    )
    const r2 = await repo.patch(
      profileId,
      [op({ op: 'replace', path: '/basics/headline', value: 'V2' })],
      'ai',
    )
    await repo.patch(
      profileId,
      [op({ op: 'add', path: '/skills/-', value: { name: 'Docker' } })],
      'user',
    )

    const snap = await repo.snapshotAt(profileId, r2.revisionId)
    expect(snap).not.toBeNull()
    expect(snap!.author).toBe('ai')
    expect(snap!.ops).toHaveLength(1)
    // Ngay sau r2 thì headline là V2 và CHƯA có Docker
    expect(snap!.after.basics.headline).toBe('V2')
    expect(snap!.after.skills).toHaveLength(1)
    // Ngay trước r2 thì vẫn là V1
    expect(snap!.before!.basics.headline).toBe('V1')
    // Còn một mốc mới hơn — con số này hiện lên UI trước khi user bấm khôi phục
    expect(snap!.newerCount).toBe(1)

    // XEM là chỉ đọc: hồ sơ và lịch sử không được đổi
    expect((await repo.get(profileId))!.basics.headline).toBe('V2')
    expect((await repo.get(profileId))!.skills).toHaveLength(2)
    expect(await repo.revisions(profileId)).toHaveLength(3)
    expect(r1.revisionId).not.toBe(r2.revisionId)
  })

  it('mốc không tồn tại → null, không ném lỗi', async () => {
    expect(await repo.snapshotAt(profileId, '999999999')).toBeNull()
  })

  it('mốc mới nhất: after là bản hiện tại, không còn mốc nào mới hơn', async () => {
    const r = await repo.patch(
      profileId,
      [op({ op: 'replace', path: '/basics/headline', value: 'Mới nhất' })],
      'user',
    )
    const snap = await repo.snapshotAt(profileId, r.revisionId)
    expect(snap!.after.basics.headline).toBe('Mới nhất')
    expect(snap!.before!.basics.headline).toBe('Backend Developer')
    expect(snap!.newerCount).toBe(0)
  })
})
