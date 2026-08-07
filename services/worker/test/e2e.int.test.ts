import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import pg from 'pg'
import { Queue, Worker, type Job } from 'bullmq'
import { Gateway, loadConfig } from '@hr/ai'
import { JobRepo, ProfileRepo } from '@hr/db'
import { QUEUE, QUEUE_PREFIX, redisConnection, type JobData } from '../src/queues.js'

/**
 * Prefix RIÊNG cho lần chạy test này.
 *
 * Dùng prefix production (`hr`) thì một worker đang chạy trên máy dev sẽ nhặt
 * mất job của test — mà worker đó trỏ vào thư mục lưu khác nên báo
 * FILE_MISSING. Test khi đó đỏ vì lý do không liên quan tới thứ đang kiểm chứng.
 */
const TEST_PREFIX = `${QUEUE_PREFIX}-e2e-${process.pid}`
import { runJob } from '../src/runner.js'
import { PdfkitClient } from '../src/pdfkit-client.js'
import { LocalStorage, contentKey } from '../src/storage.js'
import { makeParseCvHandler } from '../src/handlers/parse-cv.js'

/**
 * End-to-end THẬT cho M2-3: Redis + Postgres + pdfkit + model server.
 *
 * Không mock gì cả. Đây là bằng chứng duy nhất cho thấy luồng F1 chạy được —
 * ba bài học đắt giá trước đó (server cũ giữ cổng, build cũ, cache schema theo
 * tên task) đều là những thứ mà test có mock vẫn xanh trong khi hệ thống hỏng.
 *
 *   docker compose up -d postgres redis pdfkit && npm run db:migrate
 *   npm run test:int
 */

const CV = resolve(import.meta.dirname, '../../../eval/cv/CV-01.pdf')
const DB = process.env.DATABASE_URL ?? 'postgres://postgres:hragent_dev@localhost:5433/hragent'

let pool: pg.Pool
let storageRoot: string
let userId: string
let ready = false
let skipReason = ''

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: DB, max: 4, connectionTimeoutMillis: 3_000 })
  storageRoot = await mkdtemp(join(tmpdir(), 'hr-e2e-'))

  const checks: [string, () => Promise<boolean>][] = [
    ['postgres', async () => !!(await pool.query('SELECT 1 FROM jobs LIMIT 1').catch(() => null))],
    ['pdfkit', () => new PdfkitClient().health()],
    ['CV-01.pdf', () => readFile(CV).then(() => true, () => false)],
    [
      'model server',
      async () => {
        const base = loadConfig().providers.local.base_url
        return fetch(`${base}:5011/health`, { signal: AbortSignal.timeout(3_000) }).then(
          (r) => r.ok,
          () => false,
        )
      },
    ],
    [
      'redis',
      async () => {
        const q = new Queue('probe', { connection: redisConnection(), prefix: TEST_PREFIX })
        try {
          await q.getJobCounts()
          return true
        } catch {
          return false
        } finally {
          await q.close().catch(() => {})
        }
      },
    ],
  ]

  const missing: string[] = []
  for (const [name, check] of checks) if (!(await check())) missing.push(name)

  ready = missing.length === 0
  skipReason = missing.join(', ')

  if (ready) {
    // profiles.user_id là NOT NULL — cần một tài khoản thật để gắn profile.
    // Auth là X-1, chưa có, nên test tự tạo rồi tự dọn.
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO users (email) VALUES ($1)
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING id`,
      [`e2e-${process.pid}@test.local`],
    )
    userId = rows[0]!.id
  }
}, 60_000)

afterAll(async () => {
  if (pool) {
    await pool.query("DELETE FROM jobs WHERE idempotency_key LIKE 'e2e:%'").catch(() => {})
    // ON DELETE CASCADE dọn luôn profile của test
    await pool.query("DELETE FROM users WHERE email LIKE 'e2e-%@test.local'").catch(() => {})
    await pool.end()
  }
  if (storageRoot) await rm(storageRoot, { recursive: true, force: true })
})

describe('parse_cv end-to-end', () => {
  it(
    'upload → hàng đợi → worker → profile, đi qua hạ tầng thật',
    async () => {
      if (!ready) {
        console.warn(`⏭  bỏ qua e2e — thiếu: ${skipReason}`)
        return
      }

      const pdf = new Uint8Array(await readFile(CV))
      const storage = new LocalStorage(storageRoot)
      const key = contentKey(pdf)
      await storage.put(key, pdf)

      const jobs = new JobRepo(pool)
      const { job, created } = await jobs.enqueue({
        userId,
        kind: 'parse_cv',
        // Đổi theo lần chạy để không dùng lại kết quả cũ — ở đây ta đang kiểm
        // chứng luồng xử lý, không phải cơ chế idempotency
        idempotencyKey: `e2e:${key}:${process.pid}`,
        payload: { storageKey: key, filename: 'CV-01.pdf', outputLanguage: 'vi' },
      })
      expect(created).toBe(true)

      const handler = makeParseCvHandler({
        gateway: new Gateway(),
        pdfkit: new PdfkitClient(),
        storage,
        profiles: new ProfileRepo(pool),
        ocrEnabled: false,
      })

      const connection = redisConnection()
      const queue = new Queue<JobData>(QUEUE.parse_cv, { connection, prefix: TEST_PREFIX })
      const worker = new Worker<JobData>(
        QUEUE.parse_cv,
        async (j: Job<JobData>) =>
          runJob(
            { repo: jobs, handlers: { parse_cv: handler } },
            {
              jobId: j.data.jobId,
              attempt: j.attemptsMade + 1,
              maxAttempts: j.opts.attempts ?? 1,
              setProgress: (d) => j.updateProgress(d as object),
            },
          ),
        { connection, prefix: TEST_PREFIX, concurrency: 1 },
      )

      try {
        await queue.add('parse', { jobId: job.id }, { attempts: 1 })

        // Chờ tới trạng thái cuối. 7 mục × tối đa 90s là trần lý thuyết; CV-01
        // đo thực tế ~60-90s tổng.
        const deadline = Date.now() + 240_000
        let final = await jobs.get(job.id)
        while (Date.now() < deadline && final && (final.status === 'queued' || final.status === 'running')) {
          await new Promise((r) => setTimeout(r, 2_000))
          final = await jobs.get(job.id)
        }

        expect(final, 'job biến mất').toBeTruthy()
        expect(final!.status, `job lỗi: ${final!.error}`).toBe('done')

        const result = final!.result as Record<string, unknown>
        expect(result['profileId']).toBeTruthy()
        // Mọi field chưa xác nhận — màn hình rà soát là bắt buộc (UC-22)
        expect(result['needsReview']).toBe(true)
        // PII phải bị che trước khi gửi model (§15.2 R1)
        expect(result['piiRedacted']).toBeGreaterThan(0)

        const sections = result['sections'] as { kind: string; status: string; count: number }[]
        const parsed = sections.filter((s) => s.status === 'parsed')
        expect(parsed.length, `không mục nào parse được: ${JSON.stringify(sections)}`).toBeGreaterThan(0)

        // HỒI QUY §8.1.2: parse cả CV một lượt làm model bỏ sót mục education.
        // Chia mục là cách sửa — nên mục này không được hụt trên CV-01.
        expect(
          sections.find((s) => s.kind === 'education'),
          `education thiếu: ${JSON.stringify(sections)}`,
        ).toMatchObject({ status: 'parsed' })

        // Profile lưu được và đọc lại đúng
        const profile = await new ProfileRepo(pool).get(result['profileId'] as string)
        expect(profile).toBeTruthy()
        expect(profile!.basics.name).toBeTruthy()
        expect(profile!._meta.source).toBe('pdf_import')
        expect(profile!._meta.verified).toEqual({})
      } finally {
        await worker.close()
        await queue.obliterate({ force: true }).catch(() => {})
        await queue.close()
      }
    },
    300_000,
  )
})
