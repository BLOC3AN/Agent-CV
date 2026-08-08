import 'server-only'
import { getPool, JobRepo } from '@hr/db'
// Import theo ĐƯỜNG DẪN CON, không qua '@hr/worker': index.ts kéo theo
// `@hr/pdf` → Playwright và toàn bộ handler vào bundle Next.js, trong khi web
// chỉ cần đẩy việc vào hàng đợi.
import { getQueue, DEFAULT_JOB_OPTS } from '@hr/worker/queues'
import { LocalStorage, type Storage } from '@hr/worker/storage'
import type { JobKind } from '@hr/db'

/**
 * Cầu nối giữa web và hàng đợi — TDD §12.1, §13.
 *
 * Web CHỈ đẩy việc vào hàng đợi, không tự xử lý. Parse một CV tốn ~30-90s ở
 * model server 4 slot; làm trong request handler sẽ giữ kết nối HTTP hàng phút
 * và đổ vỡ ngay khi có người thứ hai.
 */

const g = globalThis as unknown as { __hrJobRepo?: JobRepo; __hrStorage?: Storage }

export function jobRepo(): JobRepo {
  if (!g.__hrJobRepo) g.__hrJobRepo = new JobRepo(getPool())
  return g.__hrJobRepo
}

export function storage(): Storage {
  if (!g.__hrStorage) g.__hrStorage = new LocalStorage()
  return g.__hrStorage
}

/**
 * Ghi job xuống DB rồi mới đẩy vào Redis.
 *
 * Thứ tự này quan trọng: nếu đẩy Redis trước, worker có thể nhặt job và tra DB
 * trước khi hàng ghi xong → `JOB_NOT_FOUND`. Ngược lại, ghi DB trước mà Redis
 * hỏng thì job nằm ở `queued` và reaper/retry vẫn cứu được.
 *
 * Job đã tồn tại (BR-72.1) thì KHÔNG đẩy lại — công việc đó đã chạy hoặc đang
 * chạy rồi.
 */
export async function enqueue(input: {
  userId: string | null
  kind: JobKind
  idempotencyKey: string
  payload?: Record<string, unknown>
}): Promise<{ jobId: string; created: boolean; revived: boolean; queued: boolean }> {
  let { job, created, revived } = await jobRepo().enqueue(input)

  // Idempotency không được trả lại một job parse đã xong nhưng profile đích
  // bị xóa sau đó. Nếu không kiểm tra, tải lại đúng file sẽ luôn tới review 404.
  if (!created && input.kind === 'parse_cv' && job.status === 'done') {
    const profileId = typeof job.result?.['profileId'] === 'string' ? job.result['profileId'] : null
    if (profileId) {
      const { rows } = await getPool().query(
        'SELECT 1 FROM profiles WHERE id = $1 AND user_id = $2',
        [profileId, input.userId],
      )
      if (rows.length === 0 && (await jobRepo().requeueDone(job.id, input.payload))) {
        job = (await jobRepo().get(job.id))!
        created = true
        revived = true
      }
    }
  }

  // Redis có thể mất dữ liệu trong khi Postgres vẫn giữ job `queued`. Đẩy lại
  // với chính jobId là an toàn: BullMQ dedupe nếu item cũ vẫn còn, đồng thời
  // phục hồi được item đã mất sau khi Redis restart.
  if (!created && job.status !== 'queued') {
    return { jobId: job.id, created: false, revived: false, queued: false }
  }

  try {
    await getQueue(input.kind).add(
      input.kind,
      { jobId: job.id },
      {
        ...DEFAULT_JOB_OPTS,
        // Lấy jobId của DB làm jobId của BullMQ: nếu cùng job bị đẩy hai lần
        // (hai tab, F5 giữa chừng), BullMQ bỏ qua bản trùng thay vì cho model
        // chạy hai lượt.
        jobId: job.id,
      },
    )
    return { jobId: job.id, created, revived, queued: true }
  } catch {
    // Redis chết: job vẫn nằm ở `queued` trong DB. Trả về cho user biết đã nhận
    // việc, chứ không giả vờ thành công hoàn toàn.
    return { jobId: job.id, created: true, revived, queued: false }
  }
}

/** Tách mã lỗi khỏi chuỗi `"CODE: thông điệp"` mà JobRepo ghi xuống. */
export function splitError(error: string | null): { code: string; message: string } | null {
  if (!error) return null
  const m = /^([A-Z_]+): ([\s\S]*)$/.exec(error)
  return m ? { code: m[1]!, message: m[2]! } : { code: 'INTERNAL', message: error }
}
