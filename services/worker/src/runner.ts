import { JobError, type JobRepo, type JobRow } from '@hr/db'

/**
 * Cầu nối giữa vòng đời job của BullMQ và bảng `jobs` — TDD §12.1.
 *
 * Tách riêng khỏi handler vì ba việc dưới đây LẶP LẠI ở mọi loại job và sai
 * một chỗ là user thấy trạng thái sai:
 *   1. đánh dấu running, tôn trọng lệnh huỷ
 *   2. phân biệt lỗi đáng retry với lỗi không
 *   3. ghi trạng thái cuối đúng một lần
 */

/** Ngữ cảnh handler nhận được. Không cho handler chạm BullMQ để nó test được. */
export interface JobContext {
  job: JobRow
  /**
   * Báo tiến độ. Đi vào BullMQ để SSE (`GET /api/jobs/:id/stream`) đọc được
   * mà không phải hỏi DB liên tục. Tiến độ là thông tin phù du — mất cũng
   * không sao — nên KHÔNG ghi xuống Postgres.
   */
  progress: (pct: number, note?: string) => Promise<void>
  /** Lần thử thứ mấy (1-based). */
  attempt: number
  /** Còn lần thử nào sau lần này không. */
  hasMoreAttempts: boolean
}

export type JobHandler = (ctx: JobContext) => Promise<Record<string, unknown>>

/**
 * Lỗi nào đáng thử lại.
 *
 * Mặc định KHÔNG retry, phải khai báo rõ mới retry. Ngược đời so với thói
 * quen, nhưng đúng với hệ này: phần lớn lỗi ở đây là lỗi dữ liệu (PDF hỏng,
 * schema sai, không có text layer) — thử lại chỉ tốn thời gian model đang
 * khan hiếm rồi trả về đúng lỗi cũ, trong lúc user ngồi chờ.
 */
/** Lỗi mạng/hạ tầng — hạ tầng hồi phục thì lần sau chạy được. */
const RETRYABLE_ERRNO = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EPIPE',
])

/**
 * GatewayError đáng thử lại: chỉ quá tải, timeout, mạch ngắt.
 * SCHEMA_INVALID / BUDGET_EXCEEDED / PII_GUARD thử lại vẫn hỏng y hệt — thử
 * lại chúng là tiêu thời gian model để nhận về đúng lỗi cũ.
 */
const RETRYABLE_GATEWAY = new Set([
  'MODEL_UNAVAILABLE',
  'TIMEOUT',
  'CIRCUIT_OPEN',
  'RATE_LIMITED',
])

export function isRetryable(err: unknown): boolean {
  if (err instanceof JobError) return err.retryable

  const e = err as { name?: string; code?: string }
  if (e?.name === 'GatewayError') return RETRYABLE_GATEWAY.has(e.code ?? '')
  return RETRYABLE_ERRNO.has(e?.code ?? '')
}

/** Mã lỗi để ghi log và trả về FE. Cả JobError lẫn GatewayError đều có `code`. */
export function errorCode(err: unknown): string {
  const code = (err as { code?: unknown })?.code
  return typeof code === 'string' ? code : 'INTERNAL'
}

export interface RunnerDeps {
  repo: JobRepo
  handlers: Record<string, JobHandler>
  log?: (level: 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void
}

/** Job đã bị huỷ hoặc đã xong — worker bỏ qua, không phải lỗi. */
export class JobSkipped extends Error {
  constructor(readonly jobId: string) {
    super(`Job ${jobId} bị bỏ qua (đã huỷ hoặc đã kết thúc)`)
    this.name = 'JobSkipped'
  }
}

/**
 * Chạy một job. Ném lại lỗi để BullMQ biết mà retry — nhưng CHỈ khi lỗi đáng
 * retry. Lỗi không đáng thì đã ghi `failed` vào DB và trả về bình thường, để
 * BullMQ không thử lại vô ích.
 */
export async function runJob(
  deps: RunnerDeps,
  args: {
    jobId: string
    attempt: number
    maxAttempts: number
    setProgress: (data: unknown) => Promise<void>
  },
): Promise<Record<string, unknown> | null> {
  const { repo, handlers } = deps
  const log = deps.log ?? (() => {})

  const job = await repo.get(args.jobId)
  if (!job) throw new JobError('JOB_NOT_FOUND', `Không tìm thấy job ${args.jobId}`)

  // Kiểm tra huỷ TRƯỚC khi làm gì tốn kém. User bấm huỷ lúc job còn xếp hàng
  // thì không được âm thầm chạy.
  const claimed = await repo.markRunning(job.id)
  if (!claimed) {
    log('info', `job ${job.id} bỏ qua (${job.status})`)
    return null
  }

  const handler = handlers[job.kind]
  if (!handler) {
    const err = new JobError('UNKNOWN_KIND', `Không có handler cho "${job.kind}"`)
    await repo.markFailed(job.id, err)
    return null
  }

  const hasMoreAttempts = args.attempt < args.maxAttempts

  try {
    const result = await handler({
      job,
      attempt: args.attempt,
      hasMoreAttempts,
      progress: async (pct, note) => {
        await args.setProgress({ pct: Math.max(0, Math.min(100, Math.round(pct))), note })
      },
    })
    await repo.markDone(job.id, result)
    log('info', `job ${job.id} (${job.kind}) xong`)
    return result
  } catch (err) {
    const retryable = isRetryable(err) && hasMoreAttempts
    await repo.markFailed(job.id, err, retryable)

    log(
      retryable ? 'warn' : 'error',
      `job ${job.id} (${job.kind}) lỗi [${errorCode(err)}]`,
      err,
    )

    // Ném lại CHỈ khi đáng retry — nếu không, BullMQ sẽ thử lại một lỗi đã
    // biết chắc là hỏng, chiếm slot của job khác.
    if (retryable) throw err
    return null
  }
}
