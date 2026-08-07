import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Gateway, runChatTurn, STEP_LABEL } from '@hr/ai'
import { ChatRepo, MatchRepo, getPool } from '@hr/db'
import { SqlFilterSelector, toClarifyQuestions, toPromptChunks } from '@hr/kb'
import { profileRepo } from '@/lib/db'
import { devUserId } from '@/lib/jobs'

/**
 * POST /api/chat — một lượt trò chuyện với trợ lý (UC-51/52/53).
 *
 * Chạy TRONG request chứ không qua hàng đợi: một lượt mất ~5-40 giây và người
 * dùng đang ngồi chờ ngay đó. Đưa vào hàng đợi sẽ thêm độ trễ mà không đổi
 * được điều gì — khác với parse CV, việc này không chạy nền được.
 *
 * Trả về SSE chứ không phải một JSON duy nhất. Một lượt gọi model 2-3 lần, mỗi
 * lần ~5-10 giây; im lặng suốt thời gian đó khiến người dùng không biết hệ
 * thống còn sống hay đã treo, và nhiều người sẽ bấm lại — thêm một lượt vào
 * hàng đợi vốn đã chậm.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 180

const Body = z.object({
  profileId: z.string().uuid(),
  message: z.string().min(2).max(2_000),
  /** Câu trả lời cho câu hỏi làm rõ ở lượt trước (UC-52) */
  answers: z
    .array(z.object({ question: z.string(), answer: z.string().min(1) }))
    .max(3)
    .default([]),
})

/** Bao nhiêu lượt gần nhất đưa nguyên văn vào prompt trước khi phải nén. */
const HISTORY_LIMIT = 12

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Body không hợp lệ' },
      { status: 400 },
    )
  }
  const { profileId, message, answers } = parsed.data

  let userId: string
  try {
    userId = await devUserId()
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 })
  }

  const profile = await profileRepo().get(profileId)
  if (!profile) return NextResponse.json({ error: 'Không tìm thấy hồ sơ' }, { status: 404 })

  const chat = new ChatRepo(getPool())
  const sessionId = await chat.openSession(userId, profileId)

  // Ghi tin nhắn NGƯỜI DÙNG trước khi gọi model: nếu model chết giữa chừng,
  // câu họ vừa gõ vẫn còn trong lịch sử thay vì biến mất
  const userMessageId = await chat.addMessage({ sessionId, role: 'user', content: message })

  // Câu trả lời làm rõ lưu thành tin nhắn riêng — `messageId` của chúng là
  // nguồn `grounding` hợp lệ duy nhất cho thông tin mới (BR-53.2)
  const answerRefs: { messageId: string; question: string; answer: string }[] = []
  for (const a of answers) {
    const id = await chat.addMessage({
      sessionId,
      role: 'user',
      content: `${a.question}\n→ ${a.answer}`,
    })
    answerRefs.push({ messageId: id, question: a.question, answer: a.answer })
  }

  const history = await chat.recentMessages(sessionId, HISTORY_LIMIT)
  const messageIds = new Set(history.map((m) => m.id))

  // Tri thức HR: hướng dẫn cho `propose_patch`, câu hỏi mẫu cho `insight_mining`.
  // Thiếu KB thì trợ lý vẫn chạy, chỉ là lời khuyên chung chung hơn và không
  // trích dẫn được nguồn (§10.4).
  const kb = await new SqlFilterSelector(getPool())
    .select(
      {
        industry: 'it_software',
        roleFamily: 'all',
        seniority: 'all',
        language: profile.language === 'en' ? 'en' : 'vi',
      },
      2_500,
    )
    .catch(() => null)

  // Kết quả đối chiếu gần nhất — ngữ cảnh để trả lời câu HỎI (UC-56, BR-56.2).
  // Thiếu nó thì trợ lý chỉ nói được điều chung chung; có nó thì chỉ đúng vào
  // mục nào yếu và thiếu gì.
  const analysis = await new MatchRepo(getPool()).latestForProfile(profileId).catch(() => null)

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

      try {
        const result = await runChatTurn(
          {
            gateway: new Gateway(),
            messageIds,
            // Bắn từng bước về ngay khi bắt đầu, KHÔNG chờ nó xong
            onStep: (step) => send('step', { step, label: STEP_LABEL[step] }),
            /*
             * Op bị loại vào LOG SERVER, không gửi ra client.
             *
             * Người dùng chỉ cần biết đề xuất nào dùng được; còn khi tính năng
             * hỏng thì người sửa cần biết model đã viết gì và bị loại vì sao.
             * Thiếu dòng log này, UC-57 hỏng mà log hoàn toàn im lặng — phải
             * bọc `gateway.run` bằng script riêng mới lần ra được.
             */
            onReject: (round, rejected) => {
              for (const r of rejected) {
                console.warn(
                  `[chat] vòng ${round} loại ${r.op.op} ${r.op.path}: ${r.reason} ` +
                    `| value=${JSON.stringify(r.op.value).slice(0, 200)}`,
                )
              }
            },
          },
          {
            message,
            profile,
            history: history
              .filter((m) => m.role !== 'system')
              .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
            answers: answerRefs,
            kbChunks: kb ? toPromptChunks(kb) : [],
            kbQuestions: kb ? toClarifyQuestions(kb) : [],
            analysis,
          },
        )

        if (result.kind === 'error') {
          await chat.addMessage({ sessionId, role: 'assistant', content: result.message })
          send('result', { kind: 'error', code: result.code, message: result.message, sessionId })
        } else if (result.kind === 'clarify') {
          await chat.addMessage({ sessionId, role: 'assistant', content: result.request.reason })
          send('result', { kind: 'clarify', request: result.request, sessionId })
        } else if (result.kind === 'reply') {
          // Trợ lý ĐÃ trả lời — gửi nguyên văn. Bản trước đè lên đây bằng câu
          // "Mình chưa rõ bạn muốn sửa gì", tức là hiểu đúng câu hỏi rồi vứt đi
          // và trách ngược người dùng. BR-56.1 cấm hẳn (UC-56).
          await chat.addMessage({ sessionId, role: 'assistant', content: result.text })
          send('result', {
            kind: 'reply',
            text: result.text,
            // Việc làm tiếp được: gõ lại được vào ô chat, UI hiện thành nút
            nextSteps: result.nextSteps ?? [],
            kbRefs: result.kbRefs ?? [],
            sessionId,
          })
        } else {
          // Đề xuất patch — LƯU chờ user duyệt, KHÔNG áp dụng (BR-53.1)
          const assistantId = await chat.addMessage({
            sessionId,
            role: 'assistant',
            content: result.proposal.summary,
          })
          const proposalId = await chat.saveProposal(assistantId, result.proposal)

          send('result', {
            kind: 'patch',
            sessionId,
            proposalId,
            summary: result.proposal.summary,
            ops: result.proposal.ops,
            // Op bị loại cũng báo ra: im lặng bỏ đi sẽ khiến user tưởng trợ lý
            // không nghĩ tới, trong khi thật ra nó nghĩ sai (UC-53 6a)
            rejected: result.rejected.map((r) => ({ path: r.op.path, reason: r.reason })),
            userMessageId,
          })
        }
      } catch (err) {
        send('result', {
          kind: 'error',
          code: 'INTERNAL',
          message: `Có lỗi khi xử lý: ${(err as Error).message}`,
          sessionId,
        })
      }
      finish()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Tắt buffer của proxy — nếu không, sự kiện bị giữ tới khi đầy buffer và
      // thanh trạng thái đứng im suốt cả lượt
      'X-Accel-Buffering': 'no',
    },
  })
}
