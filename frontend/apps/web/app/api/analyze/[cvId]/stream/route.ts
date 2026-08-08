import { getPool } from '@hr/db'

/**
 * GET /api/analyze/:cvId/stream — SSE cho báo cáo đối chiếu.
 *
 * Phát snapshot khi kết quả chấm điểm xuất hiện hoặc khi lời khuyên được ghi
 * thêm vào `match_analyses`. Postgres là nguồn sự thật; stream chỉ giữ một kết
 * nối HTTP sống và không làm thay đổi lifecycle của worker.
 */

export const dynamic = 'force-dynamic'

interface ReportRow {
  id: string
  score: {
    overall: number
    breakdown: Record<string, number>
    missingAtsKeywords?: string[]
    degradedReason?: string | null
  }
  matched: unknown[]
  gaps: {
    id: string
    requirement: string
    severity: string
    reason: string
    advice: string | null
    kbRefs: string[]
  }[]
  degraded: boolean
  created_at: Date
  jd_id: string
  jd_title: string | null
  jd_seniority: string | null
}

type StreamSnapshot = Record<string, unknown> & {
  ready: boolean
  advicePending?: number
  error?: string
}

async function snapshot(cvId: string): Promise<StreamSnapshot> {
  const { rows } = await getPool().query<ReportRow>(
    `SELECT m.id, m.score, m.matched, m.gaps, m.degraded, m.created_at,
            m.jd_id,
            j.requirements->>'title'     AS jd_title,
            j.requirements->>'seniority' AS jd_seniority
       FROM match_analyses m
       JOIN job_descriptions j ON j.id = m.jd_id
      WHERE m.cv_id = $1
      ORDER BY m.created_at DESC
      LIMIT 1`,
    [cvId],
  )

  if (rows.length === 0) return { ready: false }

  const r = rows[0]!
  const gaps = r.gaps ?? []
  return {
    ready: true,
    id: r.id,
    jd: { id: r.jd_id, title: r.jd_title, seniority: r.jd_seniority },
    overall: r.score.overall,
    breakdown: r.score.breakdown,
    matched: r.matched ?? [],
    gaps,
    missingAtsKeywords: r.score.missingAtsKeywords ?? [],
    degraded: r.degraded,
    degradedReason: r.score.degradedReason ?? null,
    advicePending: gaps.filter((g) => g.advice === null).length,
    createdAt: r.created_at,
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ cvId: string }> }) {
  const { cvId } = await params
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false
      let last = ''
      const send = (event: string, data: unknown): void => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          closed = true
        }
      }
      const close = (): void => {
        if (closed) return
        closed = true
        try {
          controller.close()
        } catch {
          /* client đã đóng kết nối */
        }
      }

      req.signal.addEventListener('abort', close)
      const deadline = Date.now() + 5 * 60_000

      while (!closed && Date.now() < deadline) {
        const data = await snapshot(cvId).catch(
          (error): StreamSnapshot => ({
            ready: false,
            error: error instanceof Error ? error.message : 'Không đọc được báo cáo',
          }),
        )
        const serialized = JSON.stringify(data)
        if (serialized !== last) {
          last = serialized
          send('report', data)
        }

        if ('error' in data && data.error) {
          send('error', data)
          break
        }
        if (data.ready && data.advicePending === 0) {
          send('done', data)
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000))
      }

      if (!closed && Date.now() >= deadline) send('timeout', { retry: true })
      close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
