import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Gateway, runChatTurn } from '@hr/ai'
import { ChatRepo, getPool } from '@hr/db'
import { SqlFilterSelector, toClarifyQuestions, toPromptChunks } from '@hr/kb'
import { profileRepo } from '@/lib/db'
import { devUserId } from '@/lib/jobs'

/**
 * POST /api/chat — một lượt trò chuyện với trợ lý (UC-51/52/53).
 *
 * Chạy TRONG request chứ không qua hàng đợi: một lượt mất ~5-40 giây và người
 * dùng đang ngồi chờ ngay đó. Đưa vào hàng đợi sẽ thêm độ trễ mà không đổi
 * được điều gì — khác với parse CV, việc này không chạy nền được.
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

  const result = await runChatTurn(
    { gateway: new Gateway(), messageIds },
    {
      message,
      profile,
      history: history
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      answers: answerRefs,
      kbChunks: kb ? toPromptChunks(kb) : [],
      kbQuestions: kb ? toClarifyQuestions(kb) : [],
    },
  )

  if (result.kind === 'error') {
    await chat.addMessage({ sessionId, role: 'assistant', content: result.message })
    return NextResponse.json(
      { kind: 'error', code: result.code, message: result.message, sessionId },
      { status: 200 },
    )
  }

  if (result.kind === 'clarify') {
    await chat.addMessage({
      sessionId,
      role: 'assistant',
      content: result.request.reason,
    })
    return NextResponse.json({ kind: 'clarify', request: result.request, sessionId })
  }

  if (result.kind === 'reply') {
    const text =
      'Mình chưa rõ bạn muốn sửa gì. Bạn nói cụ thể hơn giúp nhé — ví dụ ' +
      '"làm gọn mục kinh nghiệm" hoặc "thêm số liệu cho dự án đầu tiên".'
    await chat.addMessage({ sessionId, role: 'assistant', content: text })
    return NextResponse.json({ kind: 'reply', text, sessionId })
  }

  // ── Đề xuất patch — LƯU chờ user duyệt, KHÔNG áp dụng (BR-53.1) ──────
  const assistantId = await chat.addMessage({
    sessionId,
    role: 'assistant',
    content: result.proposal.summary,
  })
  const proposalId = await chat.saveProposal(assistantId, result.proposal)

  return NextResponse.json({
    kind: 'patch',
    sessionId,
    proposalId,
    summary: result.proposal.summary,
    ops: result.proposal.ops,
    // Op bị loại cũng báo ra: im lặng bỏ đi sẽ khiến user tưởng trợ lý không
    // nghĩ tới, trong khi thật ra nó nghĩ sai (UC-53 6a)
    rejected: result.rejected.map((r) => ({ path: r.op.path, reason: r.reason })),
    userMessageId,
  })
}
