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
import { answerQuestionTask, type AnswerInput } from './tasks/answer.js'
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
  | { kind: 'reply'; text: string; intent: string; nextSteps?: string[]; kbRefs?: string[] }
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
  /**
   * Kết quả đối chiếu JD gần nhất — nguồn insight tốt nhất khi user HỎI (UC-56).
   *
   * Thiếu nó thì `answer_question` chỉ còn nhận xét chung chung, đúng thứ
   * BR-56.2 cấm.
   */
  analysis?: AnswerInput['analysis']
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
  /** Câu trả lời của người dùng trong lượt này — nguồn số liệu hợp lệ thứ hai */
  answers: { answer: string }[] = [],
): { valid: PatchOp[]; rejected: RejectedOp[] } {
  const valid: PatchOp[] = []
  const rejected: RejectedOp[] = []
  const answerText = answers.map((a) => a.answer).join(' ')

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

    // RFC 6902: `add`/`replace` BẮT BUỘC có `value`; `move` bắt buộc có `from`.
    //
    // `PatchOpSchema` khai `value: z.unknown().optional()` — bắt buộc không
    // được vì `remove` không có `value`. Nên schema cho qua, và op thiếu
    // `value` chạy thẳng lên modal, user tick, bấm Áp dụng, rồi mới vỡ ở tầng
    // DB với "Patch thất bại: op replace thiếu value".
    //
    // Kiểm ở ĐÂY: op hỏng không bao giờ hiện ra để user tick nhầm.
    // `null` cũng tính là THIẾU với add/replace: schema bắt model luôn điền
  // "value" (grammar không cho vắng mặt), nên nó điền null khi bí — và null
  // ghi vào hồ sơ sẽ làm vỡ ProfileSchema ở tầng dưới.
  if ((op.op === 'add' || op.op === 'replace') && (op.value === undefined || op.value === null)) {
      rejected.push({ op, reason: `op "${op.op}" thiếu giá trị mới` })
      continue
    }
    if (op.op === 'move' && !op.from) {
      rejected.push({ op, reason: 'op "move" thiếu đường dẫn nguồn' })
      continue
    }
    if (op.op === 'move' && op.from && !pathExists(profile, op.from, 'replace')) {
      rejected.push({ op, reason: `Nguồn "${op.from}" không có trong hồ sơ` })
      continue
    }

    // Kiểu của giá trị mới phải khớp chỗ nó thay.
    //
    // Đo thật: model trả `path: "/work/0/highlights/0"` (một CHUỖI) với
    // `value: { highlights: [...] }` (một OBJECT). Đường dẫn tồn tại, `value`
    // có mặt, guard cho qua — rồi ProfileSchema từ chối ở tầng DB sau khi user
    // đã bấm Áp dụng.
    if (op.op === 'replace') {
      const before = valueAt(profile, op.path)
      const mismatch = typeMismatch(before, op.value)
      if (mismatch) {
        rejected.push({ op, reason: mismatch })
        continue
      }
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

    // BR-52.1 ở tầng CODE: con số chỉ được đến từ hồ sơ hoặc từ câu trả lời
    // của người dùng.
    //
    // Kiểm tra đường dẫn thôi là chưa đủ. Model có thể bịa "giảm 30% thời gian"
    // rồi gán `existing_field` trỏ vào một bullet CÓ THẬT nhưng không hề chứa
    // con số nào — đường dẫn hợp lệ, guard cho qua, và giao diện TICK SẴN vì
    // op "có nguồn". Đo thật: hiện tượng này xuất hiện không đều giữa các lần
    // chạy, nên nó lọt qua rất dễ.
    const invented = inventedNumbers(op, profile, answerText)
    if (invented.length > 0) {
      // KHÔNG loại hẳn: lời khuyên có thể vẫn hữu ích, chỉ là con số chưa được
      // xác nhận. Hạ xuống `inference` để giao diện cảnh báo và KHÔNG tick sẵn
      // — người dùng tự quyết định.
      valid.push({
        ...op,
        grounding: { type: 'inference', ref: op.grounding.ref },
        rationale:
          `${op.rationale} (Số liệu ${invented.join(', ')} chưa có trong hồ sơ — ` +
          'bạn kiểm lại giúp nhé.)',
      })
      continue
    }

    valid.push(op)
  }

  return { valid, rejected }
}

/** Giá trị tại một JSON Pointer, hoặc `undefined` nếu không có. */
function valueAt(profile: Profile, pointer: string): unknown {
  const parts = pointer.split('/').slice(1).map(unescapePointer)
  let node: unknown = profile
  for (const key of parts) {
    if (node === null || typeof node !== 'object') return undefined
    node = Array.isArray(node) ? node[Number(key)] : (node as Record<string, unknown>)[key]
    if (node === undefined) return undefined
  }
  return node
}

/** Mô tả sai lệch kiểu, hoặc `null` nếu khớp. */
function typeMismatch(before: unknown, after: unknown): string | null {
  if (before === undefined) return null
  const kind = (v: unknown): string =>
    Array.isArray(v) ? 'danh sách' : v === null ? 'rỗng' : typeof v === 'object' ? 'object' : typeof v
  const a = kind(before)
  const b = kind(after)
  if (a === b) return null
  return `Chỗ này đang là ${a} nhưng đề xuất thay bằng ${b}`
}

/** Con số kèm đơn vị — thứ nhà tuyển dụng đọc là thành tích. */
const METRIC =
  /\d[\d.,]*\s*(%|phần trăm|người dùng|user|khách|bản ghi|record|request|ms|giây|phút|giờ|ngày|tuần|tháng|năm|lần|triệu|nghìn|tỷ|thành viên|dự án|ticket|đơn)/gi

/**
 * Số liệu trong giá trị đề xuất mà KHÔNG tìm thấy ở hồ sơ hay câu trả lời.
 *
 * So khớp theo CHỮ SỐ chứ không theo cả cụm: hồ sơ viết "800ms" mà đề xuất viết
 * "800 mili giây" thì vẫn là cùng một số liệu, không phải bịa.
 */
function inventedNumbers(op: PatchOp, profile: Profile, answerText: string): string[] {
  const value = typeof op.value === 'string' ? op.value : JSON.stringify(op.value ?? '')
  const found = value.match(METRIC)
  if (!found) return []

  const haystack = `${JSON.stringify(profile)} ${answerText}`
  const known = new Set(haystack.match(/\d[\d.,]*/g) ?? [])

  return found.filter((m) => {
    const digits = /\d[\d.,]*/.exec(m)?.[0]
    return digits !== undefined && !known.has(digits)
  })
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
  deps.onStep?.('planning')
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
      message: errorMessage('planning', plan.error.code),
    }
  }

  const { intent, targetPath, needsInfo } = plan.data

  // ── [1b] Người dùng đang HỎI → TRẢ LỜI (UC-56) ─────────────────────
  //
  // Bản đầu trả về chuỗi rỗng ở đây, và tầng API điền vào "Mình chưa rõ bạn
  // muốn sửa gì". Nghĩa là hệ thống phân loại ĐÚNG rồi vứt đi, rồi trách ngược
  // người dùng cho một câu hỏi hoàn toàn hợp lệ — BR-56.1 cấm hẳn việc đó.
  if (intent === 'ask_question' || intent === 'explain') {
    deps.onStep?.('answering')
    const ans = await deps.gateway.run(answerQuestionTask, {
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
  if (needsInfo.length > 0 && !hasAnswers) {
    deps.onStep?.('asking')
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
  deps.onStep?.('proposing')
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
      message: errorMessage('proposing', res.error.code),
    }
  }

  deps.onStep?.('validating')
  const { valid, rejected } = validateOps(
    res.data.ops,
    input.profile,
    deps.messageIds,
    input.answers ?? [],
  )
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
    proposal: { ops: valid, summary: res.data.summary },
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
