import type { JobKind, JobRepo } from '@hr/db'
import type { Queue } from 'bullmq'
import { dispatch, type JobData } from './queues.js'

/**
 * Cứu job nằm ở `queued` mà không hàng đợi nào giữ việc — bổ sung cho
 * `JobRepo.reapStale`.
 *
 * Hai reaper bắt hai kiểu chết khác nhau:
 *   `reapStale`        job kẹt ở `running` — worker chết GIỮA CHỪNG
 *   `requeueStranded`  job kẹt ở `queued`  — việc chưa bao giờ tới tay worker
 *
 * Kiểu thứ hai từng không ai bắt, và nó im lặng hơn hẳn: không lỗi, không tiến
 * độ, SSE chỉ phát tiến độ khi job sang `running` nên user nhìn "Đang chuẩn bị"
 * cho tới lúc bỏ cuộc. Nó xảy ra khi bản BullMQ cùng `jobId` còn nằm ở trạng
 * thái cuối (lượt `add` bị khử trùng, im lặng), hoặc khi Redis mất dữ liệu.
 *
 * Chọn ĐẨY LẠI chứ không đánh `failed`: việc vẫn còn ý nghĩa, người dùng vẫn
 * đang ngồi chờ, và màn hình chờ của họ sẽ tự chạy tiếp khi worker nhận job.
 * Báo lỗi ở đây là bắt user tự tải lên lần nữa cho một sự cố của hạ tầng.
 */
export interface RequeueStrandedDeps {
  repo: JobRepo
  queueFor: (kind: JobKind) => Queue<JobData>
  log?: (level: 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void
}

export async function requeueStranded(
  deps: RequeueStrandedDeps,
  olderThanMs = 2 * 60_000,
): Promise<{ scanned: number; requeued: number }> {
  const log = deps.log ?? ((): void => {})
  const stale = await deps.repo.listStaleQueued(olderThanMs)

  let requeued = 0
  for (const job of stale) {
    try {
      // `dispatch` tự bỏ qua job còn sống — đẩy trùng nghĩa là cho model chạy
      // hai lượt trên cùng một CV.
      if (await dispatch(deps.queueFor(job.kind), job.kind, job.id)) requeued++
    } catch (err) {
      // Redis hỏng thì job vẫn ở `queued`; lượt quét sau cứu tiếp.
      log('error', `không đẩy lại được job ${job.id}`, err)
    }
  }

  return { scanned: stale.length, requeued }
}
