import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import pg from 'pg'
import { JobRepo, JobError } from '@hr/db'

/**
 * Integration test cho JobRepo — chạm Postgres THẬT.
 *
 * Không mock được: điều đang kiểm chứng là hành vi của UNIQUE constraint,
 * `xmax = 0`, và mệnh đề WHERE trong UPDATE. Mock chúng chỉ kiểm chứng cái mock.
 *
 *   docker compose up -d postgres && npm run db:migrate
 *   npm run test:int
 */

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:hragent_dev@localhost:5433/hragent'

let pool: pg.Pool
let repo: JobRepo
let available = false

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: URL, max: 4, connectionTimeoutMillis: 3_000 })
  try {
    await pool.query('SELECT 1 FROM jobs LIMIT 1')
    available = true
  } catch {
    // Không có DB thì skip chứ không fail — CI công cộng chưa chắc có Postgres
    available = false
  }
  repo = new JobRepo(pool)
})

afterAll(async () => {
  if (available) await pool.query("DELETE FROM jobs WHERE idempotency_key LIKE 'test:%'")
  await pool?.end()
})

beforeEach((c) => {
  if (!available) c.skip()
})

let n = 0
const key = (): string => `test:${process.pid}:${Date.now()}:${n++}`

describe('JobRepo.enqueue — idempotency BR-72.1', () => {
  it('lần đầu tạo mới, created = true', async () => {
    const { job, created } = await repo.enqueue({
      userId: null,
      kind: 'parse_cv',
      idempotencyKey: key(),
      payload: { storageKey: 'ab/cd.pdf' },
    })

    expect(created).toBe(true)
    expect(job.status).toBe('queued')
    expect(job.payload['storageKey']).toBe('ab/cd.pdf')
  })

  it('cùng khoá → TRẢ LẠI job cũ, created = false, không tạo bản sao', async () => {
    const k = key()
    const first = await repo.enqueue({ userId: null, kind: 'parse_cv', idempotencyKey: k })
    const second = await repo.enqueue({ userId: null, kind: 'parse_cv', idempotencyKey: k })

    expect(second.created).toBe(false)
    expect(second.job.id).toBe(first.job.id)

    const { rows } = await pool.query('SELECT count(*)::int AS c FROM jobs WHERE idempotency_key = $1', [k])
    expect(rows[0].c).toBe(1)
  })

  it('job đã xong mà enqueue lại thì KHÔNG bị reset về queued', async () => {
    // Nếu reset, user bấm tải lại cùng file sẽ mất kết quả đã có
    const k = key()
    const { job } = await repo.enqueue({ userId: null, kind: 'parse_cv', idempotencyKey: k })
    await repo.markRunning(job.id)
    await repo.markDone(job.id, { profileId: 'p1' })

    const again = await repo.enqueue({ userId: null, kind: 'parse_cv', idempotencyKey: k })
    expect(again.created).toBe(false)
    expect(again.revived).toBe(false)
    expect(again.job.status).toBe('done')
    expect(again.job.result).toEqual({ profileId: 'p1' })
  })

  it('job THẤT BẠI được hồi sinh để thử lại, không mắc kẹt với lỗi cũ', async () => {
    // Không có bước này thì user tải lại đúng file đó sẽ nhận mãi lỗi cũ, kể
    // cả khi nguyên nhân (pdfkit chết, model quá tải) đã hết
    const k = key()
    const { job } = await repo.enqueue({ userId: null, kind: 'parse_cv', idempotencyKey: k })
    await repo.markRunning(job.id)
    await repo.markFailed(job.id, new JobError('PDFKIT_UNAVAILABLE', 'chết', true), false)

    const again = await repo.enqueue({
      userId: null,
      kind: 'parse_cv',
      idempotencyKey: k,
      payload: { storageKey: 'moi.pdf' },
    })

    expect(again.job.id).toBe(job.id)
    expect(again.revived).toBe(true)
    expect(again.created).toBe(true) // ⇒ API PHẢI đẩy lại vào hàng đợi
    expect(again.job.status).toBe('queued')
    expect(again.job.error).toBeNull()
    expect(again.job.finishedAt).toBeNull()
    expect(again.job.payload['storageKey']).toBe('moi.pdf')
  })

  it('job đã HUỶ cũng hồi sinh được — user đổi ý là chuyện thường', async () => {
    const k = key()
    const { job } = await repo.enqueue({ userId: null, kind: 'parse_cv', idempotencyKey: k })
    await repo.cancel(job.id)

    const again = await repo.enqueue({ userId: null, kind: 'parse_cv', idempotencyKey: k })
    expect(again.revived).toBe(true)
    expect(again.job.status).toBe('queued')
  })

  it('job ĐANG CHỜ thì KHÔNG hồi sinh — đẩy lại sẽ cho chạy hai lượt', async () => {
    const k = key()
    await repo.enqueue({ userId: null, kind: 'parse_cv', idempotencyKey: k })
    const again = await repo.enqueue({ userId: null, kind: 'parse_cv', idempotencyKey: k })

    expect(again.job.status).toBe('queued')
    expect(again.revived).toBe(false)
    expect(again.created).toBe(false)
  })

  it('job ĐANG CHẠY thì KHÔNG hồi sinh', async () => {
    const k = key()
    const { job } = await repo.enqueue({ userId: null, kind: 'parse_cv', idempotencyKey: k })
    await repo.markRunning(job.id)

    const again = await repo.enqueue({ userId: null, kind: 'parse_cv', idempotencyKey: k })
    expect(again.created).toBe(false)
    expect(again.job.status).toBe('running')
  })

  it('hai lần enqueue song song vẫn chỉ ra một job', async () => {
    const k = key()
    const results = await Promise.all(
      Array.from({ length: 5 }, () => repo.enqueue({ userId: null, kind: 'parse_cv', idempotencyKey: k })),
    )

    expect(new Set(results.map((r) => r.job.id)).size).toBe(1)
    expect(results.filter((r) => r.created)).toHaveLength(1)
  })
})

describe('JobRepo — vòng đời', () => {
  it('markRunning tăng attempts và ghi started_at một lần duy nhất', async () => {
    const { job } = await repo.enqueue({ userId: null, kind: 'parse_cv', idempotencyKey: key() })

    expect(await repo.markRunning(job.id)).toBe(true)
    const first = await repo.get(job.id)
    expect(await repo.markRunning(job.id)).toBe(true)
    const second = await repo.get(job.id)

    expect(second!.attempts).toBe(2)
    // started_at giữ nguyên → tính được tổng thời gian chờ thật của user
    expect(second!.startedAt!.getTime()).toBe(first!.startedAt!.getTime())
  })

  it('job đã HUỶ thì markRunning trả false — worker phải bỏ qua', async () => {
    const { job } = await repo.enqueue({ userId: null, kind: 'parse_cv', idempotencyKey: key() })
    expect(await repo.cancel(job.id)).toBe(true)

    expect(await repo.markRunning(job.id)).toBe(false)
  })

  it('markDone KHÔNG ghi đè job đã huỷ', async () => {
    const { job } = await repo.enqueue({ userId: null, kind: 'parse_cv', idempotencyKey: key() })
    await repo.cancel(job.id)
    await repo.markDone(job.id, { x: 1 })

    expect((await repo.get(job.id))!.status).toBe('cancelled')
  })

  it('markFailed với willRetry giữ nguyên trạng thái running', async () => {
    // UI không được nhấp nháy giữa "lỗi" và "đang chạy" khi BullMQ retry
    const { job } = await repo.enqueue({ userId: null, kind: 'parse_cv', idempotencyKey: key() })
    await repo.markRunning(job.id)
    await repo.markFailed(job.id, new JobError('TIMEOUT', 'quá lâu'), true)

    const r = await repo.get(job.id)
    expect(r!.status).toBe('running')
    expect(r!.error).toContain('TIMEOUT')
    expect(r!.finishedAt).toBeNull()
  })

  it('markFailed lần cuối chốt failed kèm mã lỗi', async () => {
    const { job } = await repo.enqueue({ userId: null, kind: 'parse_cv', idempotencyKey: key() })
    await repo.markRunning(job.id)
    await repo.markFailed(job.id, new JobError('NO_TEXT_LAYER', 'ảnh scan'), false)

    const r = await repo.get(job.id)
    expect(r!.status).toBe('failed')
    // Mã đứng đầu để FE tách ra được mà không cần parse tiếng Việt
    expect(r!.error).toMatch(/^NO_TEXT_LAYER: /)
    expect(r!.finishedAt).not.toBeNull()
  })

  it('cancel job đã xong trả false — huỷ lúc đó không còn ý nghĩa', async () => {
    const { job } = await repo.enqueue({ userId: null, kind: 'parse_cv', idempotencyKey: key() })
    await repo.markRunning(job.id)
    await repo.markDone(job.id, {})

    expect(await repo.cancel(job.id)).toBe(false)
  })

  it('reapStale dọn job kẹt ở running', async () => {
    const { job } = await repo.enqueue({ userId: null, kind: 'parse_cv', idempotencyKey: key() })
    await repo.markRunning(job.id)
    await pool.query("UPDATE jobs SET started_at = now() - interval '2 hours' WHERE id = $1", [job.id])

    expect(await repo.reapStale(60 * 60_000)).toBeGreaterThanOrEqual(1)
    const r = await repo.get(job.id)
    expect(r!.status).toBe('failed')
    expect(r!.error).toMatch(/^STALE/)
  })

  it('reapStale KHÔNG đụng job mới chạy', async () => {
    const { job } = await repo.enqueue({ userId: null, kind: 'parse_cv', idempotencyKey: key() })
    await repo.markRunning(job.id)

    await repo.reapStale(60 * 60_000)
    expect((await repo.get(job.id))!.status).toBe('running')
  })

  it('get job không tồn tại trả null, không ném', async () => {
    expect(await repo.get('00000000-0000-0000-0000-000000000000')).toBeNull()
  })
})

describe('JobRepo.listStaleQueued — tìm job nằm chờ mà không ai nhận', () => {
  it('trả job đã ở queued quá lâu', async () => {
    // `reapStale` chỉ nhìn job kẹt ở `running`. Job kẹt ở `queued` — bản BullMQ
    // bị khử trùng, hoặc Redis mất dữ liệu — thì không ai phát hiện, và user
    // ngồi nhìn màn "Đang chuẩn bị" vĩnh viễn.
    const { job } = await repo.enqueue({ userId: null, kind: 'parse_cv', idempotencyKey: key() })
    await pool.query("UPDATE jobs SET created_at = now() - interval '10 minutes' WHERE id = $1", [
      job.id,
    ])

    const stale = await repo.listStaleQueued(5 * 60_000)
    expect(stale.map((j) => j.id)).toContain(job.id)
  })

  it('KHÔNG trả job vừa được đẩy vào — nó đang chờ hợp lệ', async () => {
    // Hàng DB được ghi TRƯỚC khi đẩy vào Redis (xem enqueue). Quét quá sớm sẽ
    // bắt nhầm đúng khe đó và đẩy trùng.
    const { job } = await repo.enqueue({ userId: null, kind: 'parse_cv', idempotencyKey: key() })

    const stale = await repo.listStaleQueued(5 * 60_000)
    expect(stale.map((j) => j.id)).not.toContain(job.id)
  })

  it('KHÔNG trả job đang chạy hay đã xong', async () => {
    const running = await repo.enqueue({ userId: null, kind: 'parse_cv', idempotencyKey: key() })
    const done = await repo.enqueue({ userId: null, kind: 'parse_cv', idempotencyKey: key() })
    await repo.markRunning(running.job.id)
    await repo.markRunning(done.job.id)
    await repo.markDone(done.job.id, {})
    await pool.query(
      "UPDATE jobs SET created_at = now() - interval '10 minutes' WHERE id = ANY($1)",
      [[running.job.id, done.job.id]],
    )

    const ids = (await repo.listStaleQueued(5 * 60_000)).map((j) => j.id)
    expect(ids).not.toContain(running.job.id)
    expect(ids).not.toContain(done.job.id)
  })
})
