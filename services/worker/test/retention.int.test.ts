import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { JobRepo, JobError } from '@hr/db'
import { LocalStorage } from '../src/storage.js'
import { purgeExpiredFiles, RETENTION_MS } from '../src/retention.js'

/**
 * TC-SEC-05 — xoá file gốc sau 48 giờ (TDD §15.2 R3).
 *
 * Đây là cam kết trong Chính sách bảo mật, không phải việc dọn ổ đĩa. Test
 * chạm Postgres thật vì điều đang kiểm chứng là câu SQL chọn job quá hạn và
 * câu đếm job dùng chung khoá.
 */

const DB = process.env.DATABASE_URL ?? 'postgres://postgres:hragent_dev@localhost:5433/hragent'

let pool: pg.Pool
let repo: JobRepo
let root: string
let storage: LocalStorage
let up = false

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: DB, max: 4, connectionTimeoutMillis: 3_000 })
  up = await pool.query('SELECT file_purged_at FROM jobs LIMIT 1').then(
    () => true,
    () => false,
  )
  repo = new JobRepo(pool)
  root = await mkdtemp(join(tmpdir(), 'hr-retention-'))
  storage = new LocalStorage(root)
})

afterAll(async () => {
  if (up) await pool.query("DELETE FROM jobs WHERE idempotency_key LIKE 'ret:%'")
  await pool?.end()
  if (root) await rm(root, { recursive: true, force: true })
})

beforeEach((c) => {
  if (!up) c.skip()
})

let n = 0
const key = (): string => `ret:${process.pid}:${Date.now()}:${n++}`

/** Tạo job kèm file thật, tuổi tuỳ ý. */
async function seed(storageKey: string, ageHours: number): Promise<string> {
  await storage.put(storageKey, new Uint8Array([0x25, 0x50, 0x44, 0x46]))
  const { job } = await repo.enqueue({
    userId: null,
    kind: 'parse_cv',
    idempotencyKey: key(),
    payload: { storageKey },
  })
  await pool.query(
    `UPDATE jobs SET created_at = now() - ($2 || ' hours')::interval WHERE id = $1`,
    [job.id, ageHours],
  )
  return job.id
}

const exists = (k: string): Promise<boolean> =>
  storage.get(k).then(
    () => true,
    () => false,
  )

describe('purgeExpiredFiles', () => {
  it('file quá 48 giờ bị xoá', async () => {
    const k = `aa/${key()}.pdf`
    const id = await seed(k, 49)

    const r = await purgeExpiredFiles(pool, storage)

    expect(r.deleted).toBeGreaterThanOrEqual(1)
    expect(await exists(k)).toBe(false)
    expect((await pool.query('SELECT file_purged_at FROM jobs WHERE id = $1', [id])).rows[0]
      .file_purged_at).not.toBeNull()
  })

  it('file CHƯA tới hạn được giữ nguyên', async () => {
    const k = `bb/${key()}.pdf`
    await seed(k, 47)

    await purgeExpiredFiles(pool, storage)

    expect(await exists(k), 'xoá sớm — user vẫn đang rà soát').toBe(true)
  })

  it('Profile vẫn còn sau khi file bị xoá', async () => {
    // TC-SEC-05: chỉ file gốc biến mất, dữ liệu đã chuẩn hoá thì không
    const k = `cc/${key()}.pdf`
    const id = await seed(k, 50)
    await pool.query(`UPDATE jobs SET status='done', result='{"profileId":"p-1"}' WHERE id=$1`, [id])

    await purgeExpiredFiles(pool, storage)

    const job = await repo.get(id)
    expect(job!.result).toEqual({ profileId: 'p-1' })
    expect(job!.status).toBe('done')
  })

  it('KHÔNG xoá file mà job khác chưa hết hạn còn dùng chung', async () => {
    // Khoá lưu trữ là sha256 nội dung → hai người tải cùng một file thì trùng
    // khoá. Xoá theo job sẽ làm hỏng job của người kia.
    const shared = `dd/${key()}.pdf`
    await seed(shared, 50) // quá hạn
    await seed(shared, 1) // còn hạn

    const r = await purgeExpiredFiles(pool, storage)

    expect(r.shared).toBeGreaterThanOrEqual(1)
    expect(await exists(shared), 'xoá mất file người khác đang dùng').toBe(true)
  })

  it('job cuối cùng hết hạn mới thật sự xoá file', async () => {
    const shared = `ee/${key()}.pdf`
    const a = await seed(shared, 50)
    const b = await seed(shared, 50)

    await purgeExpiredFiles(pool, storage)

    expect(await exists(shared)).toBe(false)
    for (const id of [a, b]) {
      const { rows } = await pool.query('SELECT file_purged_at FROM jobs WHERE id = $1', [id])
      expect(rows[0].file_purged_at, `job ${id} chưa đánh dấu`).not.toBeNull()
    }
  })

  it('chạy hai lần không xoá lại — idempotent', async () => {
    const k = `ff/${key()}.pdf`
    await seed(k, 60)

    const first = await purgeExpiredFiles(pool, storage)
    const second = await purgeExpiredFiles(pool, storage)

    expect(first.deleted).toBeGreaterThanOrEqual(1)
    // Lượt hai không được quét lại job đã dọn
    expect(second.scanned).toBe(0)
  })

  it('xoá lỗi thì KHÔNG đánh dấu — lượt sau phải thử lại', async () => {
    const k = `gg/${key()}.pdf`
    const id = await seed(k, 60)

    const broken = {
      remove: async () => {
        throw new JobError('IO', 'ổ đĩa lỗi')
      },
    } as unknown as LocalStorage

    const r = await purgeExpiredFiles(pool, broken)

    expect(r.errors).toBeGreaterThanOrEqual(1)
    const { rows } = await pool.query('SELECT file_purged_at FROM jobs WHERE id = $1', [id])
    expect(rows[0].file_purged_at, 'đánh dấu đã dọn dù file vẫn còn').toBeNull()
    expect(await exists(k)).toBe(true)
  })

  it('job không có storageKey được bỏ qua gọn gàng', async () => {
    const { job } = await repo.enqueue({
      userId: null,
      kind: 'export_pdf',
      idempotencyKey: key(),
      payload: { cvId: 'c-1' },
    })
    await pool.query(`UPDATE jobs SET created_at = now() - interval '5 days' WHERE id = $1`, [job.id])

    await expect(purgeExpiredFiles(pool, storage)).resolves.toBeTruthy()
  })

  it('thời hạn cấu hình được — 48 giờ là mặc định, không phải hằng số cứng', async () => {
    expect(RETENTION_MS).toBe(48 * 60 * 60 * 1000)

    const k = `hh/${key()}.pdf`
    await seed(k, 2)
    await purgeExpiredFiles(pool, storage, { retentionMs: 60 * 60_000 })
    expect(await exists(k)).toBe(false)
  })
})
