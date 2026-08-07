import {
  PatchOpSchema,
  type ClarifyRequest,
  type Language,
  type PatchOp,
  type PatchProposal,
  type Profile,
} from '@hr/schema'
import type { Gateway } from './gateway.js'
import { planAgentStepTask, insightMiningTask, proposePatchTask } from './tasks/agent.js'
import { redactKeepShape, stripPII } from './pii.js'

/**
 * Điều phối một lượt chat — TDD §8.3, UC-51/52/53.
 *
 * Tách khỏi tầng HTTP và tầng DB để test được mà không cần cả hai. Hàm này
 * chỉ nhận vào hồ sơ + tin nhắn, trả ra một trong ba kết quả:
 *   · `clarify` — cần hỏi thêm trước khi sửa được (UC-52)
 *   · `patch`   — đề xuất thay đổi, chờ user duyệt (UC-53)
 *   · `reply`   — chỉ trả lời, không đề xuất gì
 */

export type ChatTurnResult =
  | { kind: 'clarify'; request: ClarifyRequest; intent: string }
  | { kind: 'patch'; proposal: PatchProposal; rejected: RejectedOp[]; intent: string }
  | { kind: 'reply'; text: string; intent: string }
  | { kind: 'error'; code: string; message: string }

export interface RejectedOp {
  op: PatchOp
  reason: string
}

export interface ChatTurnInput {
  message: string
  profile: Profile
  history: { role: 'user' | 'assistant'; content: string }[]
  /** Câu trả lời của user cho câu hỏi làm rõ trước đó */
  answers?: { messageId: string; question: string; answer: string }[]
  kbChunks?: { id: string; text: string }[]
  kbQuestions?: string[]
  language?: Language
}

/**
 * Kiểm tra một op trước khi đưa lên giao diện — TDD §8.3, BR-53.2.
 *
 * Model 4B sẽ trả về op trỏ vào đường dẫn không tồn tại, hoặc bịa thông tin mà
 * gắn `grounding` sai loại. Lọc ở ĐÂY chứ không để user tự phát hiện: người
 * dùng không có cách nào biết `/work/7` là chỉ số vượt mảng.
 */
export function validateOps(
  ops: PatchOp[],
  profile: Profile,
  validMessageIds: Set<string>,
): { valid: PatchOp[]; rejected: RejectedOp[] } {
  const valid: PatchOp[] = []
  const rejected: RejectedOp[] = []

  for (const op of ops) {
    const parsed = PatchOpSchema.safeParse(op)
    if (!parsed.success) {
      rejected.push({ op, reason: 'Cấu trúc op không hợp lệ' })
      continue
    }

    if (!pathExists(profile, op.path, op.op)) {
      rejected.push({ op, reason: `Đường dẫn "${op.path}" không có trong hồ sơ` })
      continue
    }

    // `grounding.ref` trỏ tới tin nhắn KHÔNG có thật nghĩa là model bịa nguồn.
    // Nguy hiểm hơn cả bịa nội dung: giao diện sẽ tick sẵn op đó vì nó "có
    // nguồn từ người dùng".
    if (op.grounding.type === 'user_message' && !validMessageIds.has(op.grounding.ref)) {
      rejected.push({ op, reason: 'Dẫn nguồn tới tin nhắn không tồn tại' })
      continue
    }

    if (op.grounding.type === 'existing_field' && !pathExists(profile, op.grounding.ref, 'replace')) {
      rejected.push({ op, reason: 'Dẫn nguồn tới field không tồn tại' })
      continue
    }

    valid.push(op)
  }

  return { valid, rejected }
}

/**
 * Đường dẫn có dùng được không.
 *
 * `add` khoan dung hơn: `/work/-` (thêm cuối mảng) và `/basics/email` (field
 * chưa có) đều hợp lệ. `replace`/`remove` thì phải có sẵn.
 */
function pathExists(profile: Profile, pointer: string, op: PatchOp['op']): boolean {
  if (pointer === '') return false
  const parts = pointer.split('/').slice(1).map(unescapePointer)

  let node: unknown = profile
  for (const [i, key] of parts.entries()) {
    const last = i === parts.length - 1

    if (key === '-') {
      // Chỉ hợp lệ khi thêm vào cuối một MẢNG, và phải là đoạn cuối
      return op === 'add' && last && Array.isArray(node)
    }

    if (Array.isArray(node)) {
      const idx = Number(key)
      if (!Number.isInteger(idx) || idx < 0) return false
      if (idx >= node.length) return op === 'add' && last && idx === node.length
      node = node[idx]
      continue
    }

    if (node === null || typeof node !== 'object') return false
    const obj = node as Record<string, unknown>
    if (!(key in obj)) {
      // Field chưa tồn tại: chỉ `add` mới tạo được, và chỉ ở đoạn cuối
      return op === 'add' && last
    }
    node = obj[key]
  }
  return true
}

function unescapePointer(s: string): string {
  return s.replace(/~1/g, '/').replace(/~0/g, '~')
}

export interface ChatFlowDeps {
  gateway: Gateway
  /** Id các tin nhắn có thật trong phiên — dùng để kiểm `grounding` */
  messageIds: Set<string>
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
  const language = input.language ?? profileLanguage(input.profile)
  // Che PII BẮT BUỘC trước mọi lời gọi model (§15.2 R1).
  //
  // Hai dạng cho hai mục đích khác nhau:
  //   · `stripPII`        — rút gọn key, rẻ token, cho task chỉ ĐỌC
  //   · `redactKeepShape` — giữ nguyên tên field, cho task phải trả JSON Pointer
  const compactProfile = stripPII(input.profile)
  const shapedProfile = redactKeepShape(input.profile)

  // ── [1] Hiểu ý định ────────────────────────────────────────────────
  const plan = await deps.gateway.run(planAgentStepTask, {
    message: input.message,
    compactProfile,
    history: input.history,
    language,
  })
  if (!plan.ok) {
    return {
      kind: 'error',
      code: plan.error.code,
      message: 'Chưa hiểu được yêu cầu. Bạn thử diễn đạt cụ thể hơn giúp nhé.',
    }
  }

  const { intent, targetPath, needsInfo } = plan.data

  // Hỏi và giải thích thì không sinh patch
  if (intent === 'ask_question' || intent === 'explain') {
    return { kind: 'reply', text: '', intent }
  }

  // ── [2] Thiếu thông tin → HỎI, không bịa (BR-52.1) ─────────────────
  const hasAnswers = (input.answers?.length ?? 0) > 0
  if (needsInfo.length > 0 && !hasAnswers) {
    const target = targetPath ?? '/work'
    const res = await deps.gateway.run(insightMiningTask, {
      targetPath: target,
      targetContent: readPath(input.profile, target),
      needsInfo,
      kbQuestions: input.kbQuestions ?? [],
      language,
    })
    if (res.ok) return { kind: 'clarify', request: res.data, intent }
    // Không soạn được câu hỏi thì vẫn đi tiếp — trợ lý sẽ đề xuất phần làm
    // được và đánh dấu phần suy diễn, còn hơn là không giúp gì
  }

  // ── [3] Đề xuất patch ──────────────────────────────────────────────
  const res = await deps.gateway.run(proposePatchTask, {
    message: input.message,
    intent,
    targetPath,
    // Đường dẫn model trả về phải khớp hồ sơ THẬT — xem `redactKeepShape`
    compactProfile: shapedProfile,
    answers: input.answers ?? [],
    kbChunks: input.kbChunks ?? [],
    language,
  })
  if (!res.ok) {
    return {
      kind: 'error',
      code: res.error.code,
      message: 'Chưa soạn được đề xuất. Bạn thử lại sau ít phút nhé.',
    }
  }

  const { valid, rejected } = validateOps(res.data.ops, input.profile, deps.messageIds)
  if (valid.length === 0) {
    return {
      kind: 'error',
      code: 'NO_VALID_OPS',
      message:
        'Trợ lý có đề xuất nhưng không áp dụng được vào hồ sơ hiện tại. ' +
        'Bạn thử nói rõ hơn muốn sửa mục nào giúp nhé.',
    }
  }

  return {
    kind: 'patch',
    proposal: { ops: valid, summary: res.data.summary },
    rejected,
    intent,
  }
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
