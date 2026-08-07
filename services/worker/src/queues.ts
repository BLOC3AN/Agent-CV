import { Queue, type ConnectionOptions, type JobsOptions } from 'bullmq'
import type { JobKind } from '@hr/db'

/**
 * Định nghĩa hàng đợi — TDD §12.1.
 *
 * Một queue cho mỗi loại việc, không dùng chung một queue với `name` khác nhau.
 * Lý do: concurrency phải khác nhau rất nhiều. `parse_cv` bị chặn bởi model
 * server (4 slot, ~35 tok/s — C3 §2), trong khi `export_pdf` bị chặn bởi RAM
 * của Chromium. Trộn chung thì một job export nặng sẽ chiếm slot của parse.
 */

/**
 * Tên queue KHÔNG được chứa dấu `:` — BullMQ v5 ném ngay ở constructor
 * ("Queue name cannot contain :") vì nó dùng `:` làm phân cách khoá Redis.
 * Namespace đi qua `prefix` bên dưới, không nhét vào tên.
 */
export const QUEUE = {
  parse_cv: 'parse-cv',
  export_pdf: 'export-pdf',
  embed_profile: 'embed-profile',
  match_analysis: 'match-analysis',
} as const satisfies Record<JobKind, string>

/** Tách khoá của app khỏi mọi thứ khác đang dùng chung Redis. */
export const QUEUE_PREFIX = 'hr'

/**
 * Concurrency mỗi loại. Cố ý THẤP cho việc gọi model: server chỉ có 4 slot và
 * còn phục vụ 109 container khác (§2). Đẩy cao hơn không nhanh hơn, chỉ làm
 * mọi request cùng chậm và tăng nguy cơ timeout.
 */
export const CONCURRENCY: Record<JobKind, number> = {
  parse_cv: 2,
  export_pdf: 2,
  embed_profile: 4,
  match_analysis: 2,
}

/**
 * Mặc định cho job.
 *
 * `attempts: 3` với backoff mũ. Nhưng lỗi KHÔNG đáng retry (schema sai, PDF
 * hỏng, không có text layer) được chặn ở `runner.ts` — retry chúng chỉ tốn
 * thời gian model và làm user chờ lâu hơn để nhận đúng lỗi cũ.
 *
 * `removeOnComplete` giữ lại một ít để debug; lịch sử thật nằm ở bảng `jobs`.
 */
export const DEFAULT_JOB_OPTS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { count: 100, age: 3_600 },
  removeOnFail: { count: 500, age: 24 * 3_600 },
}

export interface JobData {
  /** Khoá chính trong bảng `jobs` — nguồn sự thật. */
  jobId: string
}

export function redisConnection(url?: string): ConnectionOptions {
  const target = url ?? process.env.REDIS_URL ?? 'redis://localhost:6380'
  const u = new URL(target)
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    password: u.password || undefined,
    // BullMQ yêu cầu null: retry vô hạn ở tầng lệnh sẽ giấu mất sự cố Redis
    maxRetriesPerRequest: null,
  }
}

const queues = new Map<JobKind, Queue<JobData>>()

export function getQueue(kind: JobKind, connection?: ConnectionOptions): Queue<JobData> {
  let q = queues.get(kind)
  if (!q) {
    q = new Queue<JobData>(QUEUE[kind], {
      connection: connection ?? redisConnection(),
      prefix: QUEUE_PREFIX,
      defaultJobOptions: DEFAULT_JOB_OPTS,
    })
    queues.set(kind, q)
  }
  return q
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close()))
  queues.clear()
}
