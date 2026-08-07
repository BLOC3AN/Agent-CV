import { jobRepo, splitError } from '@/lib/jobs'

/**
 * GET /api/jobs/:id/stream — SSE theo dõi tiến độ (TDD §13, FRONTEND §màn hình chờ).
 *
 * Vì sao SSE chứ không WebSocket: luồng dữ liệu một chiều, chạy trên HTTP
 * thường, tự kết nối lại — không có lý do gì để gánh thêm phức tạp của WS.
 *
 * Vì sao poll DB thay vì nghe sự kiện BullMQ: bảng `jobs` là nguồn sự thật
 * (xem `JobRepo`). Nghe BullMQ sẽ bỏ sót job do worker khác xử lý và mất tin
 * khi Redis restart. Poll 1s là rẻ so với một job kéo dài hàng chục giây.
 */

export const dynamic = 'force-dynamic'

const POLL_MS = 1_000
/** Trần thời gian sống của một kết nối. FE tự nối lại nếu job còn chạy. */
const MAX_MS = 5 * 60_000

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const repo = jobRepo()

  const job = await repo.get(id)
  if (!job) return new Response('Không tìm thấy job', { status: 404 })

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false
      const send = (event: string, data: unknown): void => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          closed = true
        }
      }

      const finish = (): void => {
        if (closed) return
        closed = true
        try {
          controller.close()
        } catch {
          /* đã đóng */
        }
      }

      // Client đóng tab / bấm huỷ — dừng poll ngay, không để rò rỉ interval
      req.signal.addEventListener('abort', finish)

      const deadline = Date.now() + MAX_MS
      let lastStatus = ''

      while (!closed && Date.now() < deadline) {
        const j = await repo.get(id).catch(() => null)
        if (!j) {
          send('error', { code: 'JOB_GONE', message: 'Job không còn tồn tại' })
          break
        }

        if (j.status !== lastStatus) {
          lastStatus = j.status
          send('status', { status: j.status, attempts: j.attempts })
        }

        if (j.status === 'done') {
          send('done', { result: j.result })
          break
        }
        if (j.status === 'failed' || j.status === 'cancelled') {
          send('failed', { status: j.status, error: splitError(j.error) })
          break
        }

        await new Promise((r) => setTimeout(r, POLL_MS))
      }

      if (!closed && Date.now() >= deadline) {
        // Nói rõ là hết hạn kết nối, không phải job hỏng — FE nối lại chứ
        // không hiện lỗi cho user
        send('timeout', { message: 'Kết nối hết hạn, hãy kết nối lại' })
      }
      finish()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Tắt buffer của nginx/proxy — nếu không, sự kiện bị giữ lại tới khi
      // đầy buffer và thanh tiến độ đứng im suốt cả job
      'X-Accel-Buffering': 'no',
    },
  })
}
