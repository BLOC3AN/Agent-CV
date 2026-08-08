import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import pg from 'pg'
import { Queue, Worker } from 'bullmq'
import { JobRepo } from '@hr/db'
import { QUEUE_PREFIX, redisConnection, type JobData } from '../src/queues.js'
import { requeueStranded } from '../src/reap-queued.js'

/**
 * Integration test cho reaper của job `queued` — Postgres + Redis THẬT.
 *
 * Kịch bản đang bảo vệ là sự cố có thật: hàng `jobs` nằm ở `queued`, còn Redis
 * giữ một bản BullMQ cùng `jobId` đã `completed`. Không ai giữ việc, không lỗi
 * nào được ghi, và màn hình chờ của user đứng ở "Đang chuẩn bị" vô thời hạn vì
 * SSE chỉ phát tiến độ khi job sang `running`.
 *
 *   docker compose up -d postgres redis && npm run db:migrate && npm run test:int
 */

const DB = process.env.DATABASE_URL ?? 'postgres://postgres:hragent_dev@localhost:5433/hragent'
/** Prefix riêng: worker trên máy dev không được nhặt job của test. */
const TEST_PREFIX = `${QUEUE_PREFIX}-reap-${process.pid}`

let pool: pg.Pool
let repo: JobRepo
let queue: Queue<JobData>
let available = false

const deps = (): Parameters<typeof requeueStranded>[0] => ({ repo, queueFor: () => queue })

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: DB, max: 4, connectionTimeoutMillis: 3_000 })
  repo = new JobRepo(pool)
  queue = new Queue<JobData>('parse-cv', { connection: redisConnection(), prefix: TEST_PREFIX })
  available =
    (await pool
      .query('SELECT 1 FROM jobs LIMIT 1')
      .then(() => true)
      .catch(() => false)) &&
    (await queue
      .getJobCounts()
      .then(() => true)
      .catch(() => false))
})

afterAll(async () => {
  if (available) {
    await pool.query("DELETE FROM jobs WHERE idempotency_key LIKE 'test-reap:%'")
    await queue.obliterate({ force: true }).catch(() => {})
  }
  await queue?.close()
  await pool?.end()
})

beforeEach(async (c) => {
  if (!available) return c.skip()
  await queue.obliterate({ force: true })
  await pool.query("DELETE FROM jobs WHERE idempotency_key LIKE 'test-reap:%'")
})

let n = 0
/** Job ở `queued` và đã quá hạn — tình trạng mà reaper phải xét tới. */
async function staleQueuedJob(): Promise<string> {
  const { job } = await repo.enqueue({
    userId: null,
    kind: 'parse_cv',
    idempotencyKey: `test-reap:${process.pid}:${Date.now()}:${n++}`,
  })
  await pool.query("UPDATE jobs SET created_at = now() - interval '10 minutes' WHERE id = $1", [
    job.id,
  ])
  return job.id
}

/** Chạy hết hàng đợi bằng worker thật rồi tắt — để lại bản BullMQ ở completed. */
async function drain(): Promise<void> {
  const w = new Worker<JobData>('parse-cv', async () => ({ profileId: 'p1' }), {
    connection: redisConnection(),
    prefix: TEST_PREFIX,
  })
  await new Promise<void>((resolve) => w.on('completed', () => resolve()))
  await w.close()
}

/*
 * Khẳng định theo TỪNG job, không đếm tổng: bảng `jobs` của môi trường dev có
 * thể còn job `queued` kẹt từ trước (chính sự cố này đẻ ra chúng), và reaper
 * quét cả chúng — đúng như nó phải làm.
 */
describe('requeueStranded — cứu job nằm chờ mà không ai giữ việc', () => {
  it('bản BullMQ đã XONG trong khi DB còn queued → đẩy lại', async () => {
    const id = await staleQueuedJob()
    await queue.add('parse_cv', { jobId: id }, { jobId: id })
    await drain()
    expect(await (await queue.getJob(id))!.getState()).toBe('completed')

    await requeueStranded(deps())

    expect(await (await queue.getJob(id))!.getState()).toBe('waiting')
  })

  it('không còn bản BullMQ nào (Redis mất dữ liệu) → đẩy lại', async () => {
    const id = await staleQueuedJob()
    expect(await queue.getJob(id)).toBeUndefined()

    await requeueStranded(deps())

    expect(await (await queue.getJob(id))!.getState()).toBe('waiting')
  })

  it('job vẫn đang chờ hợp lệ trong hàng đợi → KHÔNG đụng vào', async () => {
    // Gỡ rồi thêm lại một job đang xếp hàng sẽ đẩy nó xuống cuối hàng và làm
    // mất chỗ đứng của user — trong khi chẳng giải quyết được gì.
    const id = await staleQueuedJob()
    // Dấu vết chỉ có ở bản gốc: `dispatch` thêm mới thì payload chỉ còn `jobId`,
    // nên mất dấu này nghĩa là job đã bị gỡ rồi thêm lại.
    await queue.add('parse_cv', { jobId: id, marker: 'goc' } as JobData, { jobId: id })

    await requeueStranded(deps())

    const after = await queue.getJob(id)
    expect(await after!.getState()).toBe('waiting')
    expect(after!.data).toEqual({ jobId: id, marker: 'goc' })
  })
})
