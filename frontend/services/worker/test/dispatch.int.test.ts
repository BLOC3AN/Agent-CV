import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Queue, Worker } from 'bullmq'
import { QUEUE_PREFIX, redisConnection, dispatch, type JobData } from '../src/queues.js'

/**
 * Integration test cho `dispatch` — chạm Redis THẬT.
 *
 * Không mock được: điều đang kiểm chứng LÀ hành vi khử trùng của BullMQ. Gọi
 * `queue.add` với một `jobId` đã tồn tại thì BullMQ bỏ qua trong im lặng — không
 * ném, không trả tín hiệu nào. Một mock sẽ "add" ngoan ngoãn và test xanh trong
 * khi ngoài đời job nằm chết.
 *
 * Đây là gốc của lỗi treo màn "Đang chuẩn bị": hàng DB bị đưa về `queued` nhưng
 * bản BullMQ cũ vẫn ở trạng thái cuối, nên `add` bị nuốt và không worker nào
 * nhận việc.
 *
 *   docker compose up -d redis && npm run test:int
 */

/** Prefix riêng: worker đang chạy trên máy dev không được nhặt job của test. */
const TEST_PREFIX = `${QUEUE_PREFIX}-dispatch-${process.pid}`

let queue: Queue<JobData>
let available = false

beforeAll(async () => {
  queue = new Queue<JobData>('parse-cv', {
    connection: redisConnection(),
    prefix: TEST_PREFIX,
  })
  available = await queue
    .getJobCounts()
    .then(() => true)
    .catch(() => false)
})

beforeEach(async () => {
  if (available) await queue.obliterate({ force: true })
})

afterAll(async () => {
  if (available) await queue.obliterate({ force: true }).catch(() => {})
  await queue?.close()
})

/**
 * Chạy job tới trạng thái cuối bằng một Worker THẬT rồi tắt worker đi.
 * `moveToCompleted` gọi trực tiếp không được: nó đòi lock token của worker.
 */
async function drain(outcome: 'done' | 'fail'): Promise<void> {
  const w = new Worker<JobData>(
    'parse-cv',
    async () => {
      if (outcome === 'fail') throw new Error('pdfkit chết')
      return { profileId: 'p1' }
    },
    { connection: redisConnection(), prefix: TEST_PREFIX },
  )
  await new Promise<void>((resolve) => {
    w.on(outcome === 'fail' ? 'failed' : 'completed', () => resolve())
  })
  await w.close()
}

describe('dispatch — đưa việc vào hàng đợi bất chấp bản cũ còn sót', () => {
  it('bản BullMQ cũ ĐÃ XONG vẫn không chặn được lượt chạy mới', async (c) => {
    if (!available) c.skip()
    const id = `done-${Date.now()}`

    // Dựng đúng hiện trường: một job cùng jobId đã chạy xong và chưa bị dọn
    // (removeOnComplete giữ lại tới một giờ).
    await queue.add('parse_cv', { jobId: id }, { jobId: id })
    await drain('done')
    expect(await (await queue.getJob(id))!.getState()).toBe('completed')

    await dispatch(queue, 'parse_cv', id)

    // Nếu `add` bị nuốt, job vẫn ở completed và user chờ mãi không ai xử lý
    expect(await (await queue.getJob(id))!.getState()).toBe('waiting')
    expect((await queue.getJobCounts()).waiting).toBe(1)
  })

  it('bản BullMQ cũ ĐÃ HỎNG cũng vậy — hồi sinh phải chạy lại được', async (c) => {
    if (!available) c.skip()
    const id = `failed-${Date.now()}`

    await queue.add('parse_cv', { jobId: id }, { jobId: id, attempts: 1 })
    await drain('fail')
    expect(await (await queue.getJob(id))!.getState()).toBe('failed')

    await dispatch(queue, 'parse_cv', id)

    expect(await (await queue.getJob(id))!.getState()).toBe('waiting')
  })

  it('job ĐANG CHỜ thì không đẩy thêm bản trùng', async (c) => {
    if (!available) c.skip()
    const id = `waiting-${Date.now()}`

    await dispatch(queue, 'parse_cv', id)
    await dispatch(queue, 'parse_cv', id)

    const counts = await queue.getJobCounts()
    expect(counts.waiting).toBe(1)
  })
})
