import type {
  ClarifyRequest,
  Language,
  PatchOp,
  PatchProposal,
  Profile,
} from '@hr/schema'
import type { Gateway } from './gateway.js'
import type { TaskDefinition } from './types.js'
import {
  planAgentStepTask,
  insightMiningTask,
  proposePatchTask,
  type ProposePatchInput,
} from './tasks/agent.js'
import { answerQuestionTask, type AnswerInput } from './tasks/answer.js'
import { redactKeepShape, stripPII } from './pii.js'
import { expandCompactPath, humanizePointers, sectionLabel } from './paths.js'
import {
  cleanProposal,
  unescapePointer,
  validateOps,
  type RejectedOp,
} from './patch-guard.js'

/**
 * Điều phối một lượt chat — TDD §8.3, UC-51/52/53.
 *
 * Tách khỏi tầng HTTP và tầng DB để test được mà không cần cả hai. Hàm này
 * chỉ nhận vào hồ sơ + tin nhắn, trả ra một trong ba kết quả:
 *   · `clarify` — cần hỏi thêm trước khi sửa được (UC-52)
 *   · `patch`   — đề xuất thay đổi, chờ user duyệt (UC-53)
 *   · `reply`   — chỉ trả lời, không đề xuất gì
 *
 * Phần KIỂM DUYỆT op nằm ở `patch-guard.ts` — xem ghi chú đầu file đó.
 */

// Kiểu và hàm kiểm duyệt vẫn xuất qua đây: `@hr/ai` là một entry point, chỗ gọi
// không cần biết nội bộ package vừa được sắp xếp lại.
export { validateOps, type RejectedOp } from './patch-guard.js'

export type ChatTurnResult =
  | { kind: 'clarify'; request: ClarifyRequest; intent: string }
  | { kind: 'patch'; proposal: PatchProposal; rejected: RejectedOp[]; intent: string }
  | { kind: 'reply'; text: string; intent: string; nextSteps?: string[]; kbRefs?: string[] }
  | { kind: 'error'; code: string; message: string }

export interface ChatTurnInput {
  message: string
  profile: Profile
  history: { role: 'user' | 'assistant'; content: string }[]
  /** Câu trả lời của user cho câu hỏi làm rõ trước đó */
  answers?: { messageId: string; question: string; answer: string }[]
  kbChunks?: { id: string; text: string }[]
  kbQuestions?: string[]
  /**
   * Kết quả đối chiếu JD gần nhất — nguồn insight tốt nhất khi user HỎI (UC-56).
   *
   * Thiếu nó thì `answer_question` chỉ còn nhận xét chung chung, đúng thứ
   * BR-56.2 cấm.
   */
  analysis?: AnswerInput['analysis']
  language?: Language
  /** Optional UI-selected chat model; server validates the allow-list. */
  modelRef?: string
  hint?: ProposePatchInput['hint']
}

/** Các bước người dùng CHỜ — mỗi bước là một lượt gọi model. */
export type ChatStep = 'planning' | 'answering' | 'asking' | 'proposing' | 'validating'

export const STEP_LABEL: Record<ChatStep, string> = {
  planning: 'Đang hiểu yêu cầu của bạn',
  answering: 'Đang xem lại hồ sơ để trả lời',
  asking: 'Đang soạn câu hỏi làm rõ',
  proposing: 'Đang soạn đề xuất chỉnh sửa',
  validating: 'Đang kiểm tra đề xuất',
}

export interface ChatFlowDeps {
  gateway: Gateway
  modelRef?: string
  signal?: AbortSignal
  /** Id các tin nhắn có thật trong phiên — dùng để kiểm `grounding` */
  messageIds: Set<string>
  /**
   * Báo bước đang chạy.
   *
   * Một lượt chat gọi model 2-3 lần, mỗi lần ~5-10 giây. Không báo gì thì
   * người dùng nhìn "Đang suy nghĩ…" suốt nửa phút và không biết hệ thống còn
   * sống hay đã treo — nhiều người sẽ bấm lại, và bấm lại là thêm một lượt
   * vào hàng đợi vốn đã chậm.
   */
  onStep?: (step: ChatStep) => void
  /**
   * Báo các op BỊ LOẠI, kèm vòng validate thứ mấy.
   *
   * Vì sao cần: khi UC-57 hỏng trên hồ sơ thật, log của Next chỉ có dòng khởi
   * động và log worker chỉ có `parse_cv`. Không chỗ nào ghi op nào bị loại vì
   * lý do gì, nên phải bọc `gateway.run` bằng script riêng mới chẩn đoán được.
   *
   * Hệ thống biết chính xác nó vừa loại gì — không kể ra là tự bịt mắt mình.
   */
  onReject?: (round: 1 | 2, rejected: { op: PatchOp; reason: string }[]) => void
}

/**
 * Chạy một lượt chat.
 *
 * Ba bước nối tiếp, dừng sớm khi đủ: nhiều CV chỉ cần bước 1 (người dùng đang
 * hỏi chứ chưa muốn sửa), và mỗi bước là một lượt gọi model ~3-30 giây.
 */
export async function runChatTurn(
  deps: ChatFlowDeps,
  input: ChatTurnInput,
): Promise<ChatTurnResult> {
  const run = <TInput, TOutput>(task: TaskDefinition<TInput, TOutput>, input: TInput) =>
    deps.gateway.run(task, input, {
      ...(deps.modelRef ? { forceModel: deps.modelRef } : {}),
      ...(deps.signal ? { signal: deps.signal } : {}),
    })
  const language = input.language ?? profileLanguage(input.profile)
  // Che PII BẮT BUỘC trước mọi lời gọi model (§15.2 R1).
  //
  // Hai dạng cho hai mục đích khác nhau:
  //   · `stripPII`        — rút gọn key, rẻ token, cho task chỉ ĐỌC
  //   · `redactKeepShape` — giữ nguyên tên field, cho task phải trả JSON Pointer
  const compactProfile = stripPII(input.profile)
  const shapedProfile = redactKeepShape(input.profile)

  // ── [1] Hiểu ý định ────────────────────────────────────────────────
  deps.onStep?.('planning')
  const plan = await run(planAgentStepTask, {
    message: input.message,
    compactProfile,
    history: input.history,
    language,
    hint: input.hint,
  })
  if (!plan.ok) {
    return {
      kind: 'error',
      code: plan.error.code,
      message: errorMessage('planning', plan.error.code),
    }
  }

  const { intent, needsInfo } = plan.data
  // `plan_agent_step` đọc CompactProfile nên trả con trỏ RÚT GỌN (`/act`).
  // Dịch về không gian tên thật trước khi dùng ở bất cứ đâu — xem `paths.ts`.
  const targetPath = expandCompactPath(plan.data.targetPath)

  // ── [1b] Người dùng đang HỎI → TRẢ LỜI (UC-56) ─────────────────────
  //
  // Bản đầu trả về chuỗi rỗng ở đây, và tầng API điền vào "Mình chưa rõ bạn
  // muốn sửa gì". Nghĩa là hệ thống phân loại ĐÚNG rồi vứt đi, rồi trách ngược
  // người dùng cho một câu hỏi hoàn toàn hợp lệ — BR-56.1 cấm hẳn việc đó.
  if (intent === 'ask_question' || intent === 'explain') {
    deps.onStep?.('answering')
    const ans = await run(answerQuestionTask, {
      question: input.message,
      compactProfile,
      analysis: input.analysis ?? null,
      kbChunks: input.kbChunks ?? [],
      language,
    })
    if (!ans.ok) {
      return {
        kind: 'error',
        code: ans.error.code,
        message: errorMessage('answering', ans.error.code),
      }
    }
    return {
      kind: 'reply',
      text: ans.data.answer,
      intent,
      nextSteps: ans.data.nextSteps,
      kbRefs: ans.data.kbRefs,
    }
  }

  // ── [2] Thiếu thông tin → HỎI, không bịa (BR-52.1) ─────────────────
  const hasAnswers = (input.answers?.length ?? 0) > 0
  // Hỏi lại y hệt câu vừa hỏi là ngõ cụt.
  //
  // Đo thật: người dùng gõ lại NGUYÊN VĂN yêu cầu cũ thay vì điền form —
  // nghĩa là họ không có gì để bổ sung, hoặc form không hỏi trúng. Hỏi tiếp
  // thì họ gõ lại tiếp, và vòng lặp không có lối ra.
  //
  // Lần thứ hai thì đề xuất bằng những gì đang có. Phần suy diễn sẽ mang
  // `inference` nên giao diện không tick sẵn — người dùng vẫn nắm quyền quyết.
  const askedBefore =
    input.history.filter((m) => m.role === 'user' && m.content.trim() === input.message.trim())
      .length > 1
  if (needsInfo.length > 0 && !hasAnswers && !askedBefore) {
    deps.onStep?.('asking')
    const target = targetPath ?? '/work'
    const res = await run(insightMiningTask, {
      targetPath: target,
      targetLabel: sectionLabel(target),
      targetContent: readPath(input.profile, target),
      needsInfo,
      kbQuestions: input.kbQuestions ?? [],
      language,
    })
    if (res.ok) {
      return {
        kind: 'clarify',
        // Chốt chặn cuối: `reason` là chuỗi model viết cho NGƯỜI ĐỌC, và nó đã
        // lộ `/act` ra màn hình thật. Prompt dặn rồi vẫn lộ, nên chặn ở đây.
        request: { ...res.data, reason: humanizePointers(res.data.reason) },
        intent,
      }
    }
    // Không soạn được câu hỏi thì vẫn đi tiếp — trợ lý sẽ đề xuất phần làm
    // được và đánh dấu phần suy diễn, còn hơn là không giúp gì
  }

  // ── [3] Đề xuất patch ──────────────────────────────────────────────
  deps.onStep?.('proposing')
  const res = await run(proposePatchTask, {
    message: input.message,
    intent,
    targetPath,
    // Đường dẫn model trả về phải khớp hồ sơ THẬT — xem `redactKeepShape`
    compactProfile: shapedProfile,
    answers: input.answers ?? [],
    kbChunks: input.kbChunks ?? [],
    language,
    hint: input.hint,
  })
  if (!res.ok) {
    return {
      kind: 'error',
      code: res.error.code,
      message: errorMessage('proposing', res.error.code),
    }
  }

  deps.onStep?.('validating')
  let { valid, rejected } = validateOps(
    res.data.ops,
    input.profile,
    deps.messageIds,
    input.answers ?? [],
  )
  if (rejected.length > 0) deps.onReject?.(1, rejected)

  // Không op nào dùng được → NÓI CHO MODEL BIẾT NÓ SAI Ở ĐÂU rồi thử lại một lần.
  //
  // Prompt cấm chung chung không ăn thua: đo trên hồ sơ thật, model lặp lại
  // đúng một lỗi (`{"$ref": …}` ở chỗ đáng lẽ là chuỗi) dù prompt đã cấm hẳn
  // kèm ví dụ. Chỉ ra ĐÚNG op vừa hỏng thì có. Một lần thôi — thêm lượt gọi là
  // thêm 5-10 giây người dùng ngồi chờ.
  if (valid.length === 0 && rejected.length > 0) {
    deps.onStep?.('proposing')
    const retry = await run(proposePatchTask, {
      message: input.message,
      intent,
      targetPath,
      compactProfile: shapedProfile,
      answers: input.answers ?? [],
      kbChunks: input.kbChunks ?? [],
      language,
      corrections: rejected.slice(0, 5).map((r) => `${r.op.op} ${r.op.path}: ${r.reason}`),
    })
    if (retry.ok) {
      deps.onStep?.('validating')
      const second = validateOps(
        retry.data.ops,
        input.profile,
        deps.messageIds,
        input.answers ?? [],
      )
      if (second.rejected.length > 0) deps.onReject?.(2, second.rejected)
      if (second.valid.length > 0) {
        return {
          kind: 'patch',
          proposal: cleanProposal(
            { ops: second.valid, summary: retry.data.summary },
            second.rejected.length,
          ),
          rejected: second.rejected,
          intent,
        }
      }
      // Lượt sửa cũng hỏng → giữ lý do của lượt sửa, nó sát thực tế hơn
      rejected = second.rejected.length > 0 ? second.rejected : rejected
    }
  }

  // Vẫn không có gì dùng được, mà bước hỏi đã bị bỏ qua → HỎI, đừng báo lỗi.
  //
  // Bỏ qua bước hỏi là để tránh vòng lặp (người dùng gõ lại y hệt). Nhưng nếu
  // đề xuất soạn ra không dùng được, thì thứ còn thiếu chính là thông tin —
  // và hỏi vẫn hơn là trả về một câu lỗi không có lối đi tiếp.
  // `!hasAnswers` là điều kiện thiết yếu: người dùng vừa điền form xong mà lại
  // nhận thêm một form nữa thì công họ bỏ ra thành vô ích.
  if (valid.length === 0 && askedBefore && !hasAnswers && needsInfo.length > 0) {
    deps.onStep?.('asking')
    const target = targetPath ?? '/work'
    const ask = await run(insightMiningTask, {
      targetPath: target,
      targetLabel: sectionLabel(target),
      targetContent: readPath(input.profile, target),
      needsInfo,
      kbQuestions: input.kbQuestions ?? [],
      language,
    })
    if (ask.ok) {
      return {
        kind: 'clarify',
        request: { ...ask.data, reason: humanizePointers(ask.data.reason) },
        intent,
      }
    }
  }

  if (valid.length === 0) {
    return {
      kind: 'error',
      code: 'NO_VALID_OPS',
      // Hệ thống BIẾT vì sao — phải nói ra. Câu "bạn thử nói rõ hơn" là lời
      // trách người dùng cho một việc họ đã làm đúng: đo thật, họ gõ "thêm số
      // liệu cho dự án đầu tiên" trên một CV KHÔNG CÓ mục dự án nào.
      message: explainNoValidOps(rejected, input.profile),
    }
  }

  return {
    kind: 'patch',
    proposal: cleanProposal({ ops: valid, summary: res.data.summary }, rejected.length),
    rejected,
    intent,
  }
}

/**
 * Thông điệp lỗi nói rõ HỎNG Ở ĐÂU và LÀM GÌ TIẾP.
 *
 * "Bạn thử lại sau ít phút nhé" là câu vô dụng khi nguyên nhân là ngữ cảnh quá
 * dài hoặc yêu cầu quá mơ hồ — thử lại y hệt sẽ hỏng y hệt.
 */
function errorMessage(step: ChatStep, code: string): string {
  if (code === 'PROVIDER_DISABLED') {
    return 'Model cloud chưa sẵn sàng. Bạn kiểm tra API key hoặc chọn Neura flash để tiếp tục nhé.'
  }
  if (code === 'BAD_INPUT') {
    return 'Model cloud không chấp nhận cấu hình request hiện tại. Bạn chọn lại model hoặc thử Neura flash nhé.'
  }
  if (code === 'RATE_LIMITED') {
    return 'Model cloud đang giới hạn lượt gọi. Bạn thử lại sau khoảng một phút hoặc chọn Neura flash nhé.'
  }
  if (code === 'TIMEOUT' || code === 'MODEL_UNAVAILABLE' || code === 'CIRCUIT_OPEN') {
    return 'Máy chủ AI đang quá tải. Bạn thử lại sau khoảng một phút giúp nhé.'
  }
  if (code === 'BUDGET_EXCEEDED') {
    return 'Cuộc trò chuyện đã dài. Bạn mở phiên mới hoặc nói ngắn gọn hơn giúp nhé.'
  }
  if (code === 'SCHEMA_INVALID') {
    if (step === 'answering') {
      return 'Trợ lý chưa soạn được câu trả lời gọn gàng. Bạn thử hỏi cụ thể hơn giúp nhé — ví dụ "CV của tôi yếu chỗ nào?".'
    }
    return step === 'planning'
      ? 'Mình chưa hiểu rõ yêu cầu. Bạn nói cụ thể muốn sửa mục nào giúp nhé — ví dụ "làm gọn mục kinh nghiệm".'
      : 'Trợ lý soạn đề xuất chưa đúng định dạng. Bạn thử diễn đạt lại yêu cầu cụ thể hơn giúp nhé.'
  }
  return 'Chưa xử lý được yêu cầu này. Bạn thử nói theo cách khác giúp nhé.'
}

/**
 * Giải thích vì sao không đề xuất nào dùng được.
 *
 * Ưu tiên nguyên nhân NGƯỜI DÙNG SỬA ĐƯỢC: mục chưa có trong CV. Đó gần như
 * luôn là lý do thật, và cũng là lý do duy nhất họ hành động được.
 */
function explainNoValidOps(rejected: RejectedOp[], profile: Profile): string {
  const SECTION_LABEL: Record<string, { label: string; empty: boolean }> = {
    projects: { label: 'Dự án', empty: profile.projects.length === 0 },
    work: { label: 'Kinh nghiệm', empty: profile.work.length === 0 },
    education: { label: 'Học vấn', empty: profile.education.length === 0 },
    skills: { label: 'Kỹ năng', empty: profile.skills.length === 0 },
    activities: { label: 'Hoạt động', empty: profile.activities.length === 0 },
    certifications: { label: 'Chứng chỉ', empty: profile.certifications.length === 0 },
  }

  const missing = new Set<string>()
  for (const r of rejected) {
    const top = r.op.path.split('/')[1]
    const info = top ? SECTION_LABEL[top] : undefined
    if (info?.empty) missing.add(info.label)
  }

  if (missing.size > 0) {
    const names = [...missing].join(', ')
    return (
      `CV của bạn chưa có mục ${names}, nên trợ lý không sửa được ở đó. ` +
      `Bạn thêm mục ${names} vào CV trước, rồi quay lại nhờ trợ lý viết cho hay hơn nhé.`
    )
  }

  // Không phải do thiếu mục — nêu lý do đầu tiên, đã viết cho người đọc
  const first = rejected[0]?.reason
  return first
    ? `Trợ lý soạn đề xuất chưa dùng được: ${first.toLowerCase()}. Bạn thử nói cụ thể hơn giúp nhé.`
    : 'Trợ lý chưa soạn được đề xuất áp dụng được. Bạn thử nói theo cách khác giúp nhé.'
}

function profileLanguage(p: Profile): Language {
  return p.language === 'en' ? 'en' : 'vi'
}

/** Đọc nội dung tại một JSON Pointer, gộp thành chuỗi để đưa vào prompt. */
function readPath(profile: Profile, pointer: string): string {
  const parts = pointer.split('/').slice(1).map(unescapePointer)
  let node: unknown = profile
  for (const key of parts) {
    if (node === null || typeof node !== 'object') return ''
    node = Array.isArray(node)
      ? node[Number(key)]
      : (node as Record<string, unknown>)[key]
    if (node === undefined) return ''
  }
  return typeof node === 'string' ? node : JSON.stringify(node).slice(0, 1_500)
}
