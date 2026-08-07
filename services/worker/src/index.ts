import { Worker, type Job } from 'bullmq'
import { Gateway, loadConfig } from '@hr/ai'
import { JobRepo, MatchRepo, ProfileRepo, getPool, closePool, type JobKind } from '@hr/db'
import { closeBrowser } from '@hr/pdf'
import { SqlFilterSelector, toPromptChunks } from '@hr/kb'
import {
  CONCURRENCY,
  QUEUE,
  QUEUE_PREFIX,
  redisConnection,
  closeQueues,
  type JobData,
} from './queues.js'
import { runJob, type JobHandler, type RunnerDeps } from './runner.js'
import { PdfkitClient } from './pdfkit-client.js'
import { LocalStorage } from './storage.js'
import { makeParseCvHandler } from './handlers/parse-cv.js'
import { makeExportPdfHandler } from './handlers/export-pdf.js'
import { makeMatchAnalysisHandler } from './handlers/match-analysis.js'
import { purgeExpiredFiles } from './retention.js'

/**
 * Điểm khởi động worker — TDD §12.1.
 *
 * Một tiến trình, nhiều BullMQ Worker (một cho mỗi queue) vì concurrency khác
 * nhau rất nhiều giữa các loại việc — xem `queues.ts`.
 */

function log(level: 'info' | 'warn' | 'error', msg: string, meta?: unknown): void {
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${msg}`
  if (level === 'error') console.error(line, meta ?? '')
  else if (level === 'warn') console.warn(line, meta ?? '')
  else console.log(line)
}

/** Lấy dịch vụ tuỳ chọn; thiếu thì `null` chứ không làm sập cả worker. */
function optional<T>(get: () => T): T | null {
  try {
    return get()
  } catch (err) {
    log('warn', `dịch vụ tuỳ chọn không khả dụng: ${(err as Error).message}`)
    return null
  }
}

function buildHandlers(): Record<string, JobHandler> {
  const pool = getPool()
  const cfg = loadConfig()
  const storage = new LocalStorage()

  const gateway = new Gateway({
    config: cfg,
    logger: (meta, err) => {
      // TDD §15.2 R6: chỉ ghi METRIC, tuyệt đối không ghi nội dung prompt.
      pool
        .query(
          `INSERT INTO llm_calls (task, provider, model, latency_ms, prompt_tokens,
                                  completion_tokens, schema_valid, attempts,
                                  escalated, truncated, error_code)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            meta.task,
            meta.provider,
            meta.model,
            meta.latencyMs,
            meta.promptTokens,
            meta.completionTokens,
            meta.schemaValid,
            meta.attempts,
            meta.escalated,
            meta.truncated,
            err?.code ?? null,
          ],
        )
        .catch((e) => log('warn', 'không ghi được llm_calls', e))
    },
  })

  // Đường ảnh bật/tắt theo config, không hardcode: khi :5012 sống lại chỉ cần
  // đổi `routing.ocr_cv_page.enabled` (TDD §2.6).
  const ocrEnabled =
    (cfg.routing as Record<string, { enabled?: boolean } | undefined>)['ocr_cv_page']?.enabled ===
    true

  return {
    parse_cv: makeParseCvHandler({
      gateway,
      pdfkit: new PdfkitClient(),
      storage,
      profiles: new ProfileRepo(pool),
      ocrEnabled,
    }),
    export_pdf: makeExportPdfHandler({ pool, storage }),
    match_analysis: makeMatchAnalysisHandler({
      gateway,
      repo: new MatchRepo(pool),
      // `registry.embed()` NÉM lỗi khi chưa cấu hình — gọi trần ở đây sẽ làm
      // worker không khởi động nổi vì thiếu một dịch vụ vốn chỉ là tuỳ chọn.
      // Không có nó thì `analyze` bỏ lớp ngữ nghĩa và đánh dấu `degraded`,
      // đúng tinh thần "suy giảm, đừng sập" (A7).
      embedder: optional(() => gateway.registry.embed()),
      reranker: optional(() => gateway.registry.rerank()),
      // Tri thức HR cho `gap_analysis`. Ngân sách 3.500 token khớp với `max`
      // của section `kb` trong task — chọn nhiều hơn cũng bị cắt ở đó.
      selectKb: async (ctx) => {
        const k = await new SqlFilterSelector(pool).select(
          {
            industry: ctx.industry,
            roleFamily: ctx.roleFamily,
            seniority: ctx.seniority,
            language: ctx.language === 'en' ? 'en' : 'vi',
          },
          3_500,
        )
        return toPromptChunks(k)
      },
    }),
  }
}

export function startWorkers(): Worker<JobData>[] {
  const pool = getPool()
  const deps: RunnerDeps = { repo: new JobRepo(pool), handlers: buildHandlers(), log }
  const connection = redisConnection()

  const kinds = Object.keys(deps.handlers) as JobKind[]
  return kinds.map((kind) => {
    const w = new Worker<JobData>(
      QUEUE[kind],
      async (job: Job<JobData>) =>
        runJob(deps, {
          jobId: job.data.jobId,
          attempt: job.attemptsMade + 1,
          maxAttempts: job.opts.attempts ?? 1,
          setProgress: (d) => job.updateProgress(d as object),
        }),
      // prefix PHẢI khớp với queue bên `queues.ts`, nếu không worker nghe một
      // khoá Redis khác và job nằm im mãi mà không ai báo lỗi.
      { connection, prefix: QUEUE_PREFIX, concurrency: CONCURRENCY[kind] },
    )

    // BullMQ nuốt lỗi ở tầng kết nối nếu không nghe 'error' — im lặng ở đây
    // nghĩa là Redis chết mà không ai biết.
    w.on('error', (err) => log('error', `worker ${kind} lỗi kết nối`, err))
    w.on('failed', (job, err) => log('warn', `job ${job?.data?.jobId} thất bại: ${err.message}`))

    log('info', `worker ${kind} sẵn sàng (concurrency ${CONCURRENCY[kind]})`)
    return w
  })
}

async function main(): Promise<void> {
  const workers = startWorkers()
  const repo = new JobRepo(getPool())

  // Job kẹt ở `running` = worker chết giữa chừng. Không dọn thì user chờ mãi.
  const reaper = setInterval(() => {
    repo
      .reapStale()
      .then((n) => n > 0 && log('warn', `dọn ${n} job treo`))
      .catch((e) => log('error', 'reaper lỗi', e))
  }, 5 * 60_000)
  reaper.unref()

  // Xoá file gốc quá 48 giờ — TDD §15.2 R3. Đây là cam kết trong Chính sách
  // bảo mật, không phải việc dọn ổ đĩa: không chạy thì lời cam kết thành nói dối.
  const pool = getPool()
  const storage = new LocalStorage()
  const purgeOnce = (): void => {
    purgeExpiredFiles(pool, storage)
      .then((r) => {
        if (r.scanned > 0) {
          log('info', `dọn file: xoá ${r.deleted}, dùng chung ${r.shared}, lỗi ${r.errors}`)
        }
      })
      .catch((e) => log('error', 'dọn file lỗi', e))
  }
  purgeOnce() // chạy ngay khi khởi động: worker có thể đã tắt nhiều ngày
  const purger = setInterval(purgeOnce, 60 * 60_000)
  purger.unref()

  let closing = false
  const shutdown = async (sig: string): Promise<void> => {
    if (closing) return
    closing = true
    log('info', `nhận ${sig}, đang dừng…`)
    clearInterval(reaper)
    clearInterval(purger)
    // Đóng worker TRƯỚC: chờ job đang chạy xong thay vì cắt ngang, nếu không
    // job đó sẽ kẹt ở `running` cho tới lượt reaper.
    await Promise.all(workers.map((w) => w.close()))
    await closeQueues()
    await closeBrowser()
    await closePool()
    log('info', 'đã dừng gọn')
    process.exit(0)
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

// Chỉ chạy khi được gọi trực tiếp — import từ test thì không khởi động gì.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    log('error', 'worker không khởi động được', err)
    process.exit(1)
  })
}

export { QUEUE, QUEUE_PREFIX, CONCURRENCY, getQueue } from './queues.js'
export { runJob, isRetryable, type JobContext, type JobHandler } from './runner.js'
export { PdfkitClient } from './pdfkit-client.js'
export { LocalStorage, contentKey, jobKey } from './storage.js'
export { makeParseCvHandler, decideRoute } from './handlers/parse-cv.js'
export { makeExportPdfHandler } from './handlers/export-pdf.js'
export { makeMatchAnalysisHandler } from './handlers/match-analysis.js'
export { purgeExpiredFiles, RETENTION_MS } from './retention.js'
