import fastJsonPatch from 'fast-json-patch'
import {
  allowedFieldsAt,
  PatchOpSchema,
  ProfileSchema,
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
import { expandCompactPath, humanizePointers, sectionLabel } from './paths.js'

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
  const unsafeRemoval = unsafeRemovals(ops)

  for (const op of ops) {
    const removalIssue = unsafeRemoval.get(op)
    if (removalIssue) {
      rejected.push({ op, reason: removalIssue })
      continue
    }

    const parsed = PatchOpSchema.safeParse(op)
    if (!parsed.success) {
      rejected.push({ op, reason: 'Cấu trúc op không hợp lệ' })
      continue
    }

    const invalidPath = invalidPathReason(profile, op)
    if (invalidPath) {
      rejected.push({ op, reason: invalidPath })
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
      if (sameJsonValue(before, op.value)) {
        rejected.push({ op, reason: 'Nội dung không thay đổi' })
        continue
      }
    }

    // Chốt chặn HÌNH DẠNG: thử áp op lên bản sao rồi kiểm lại bằng ProfileSchema.
    //
    // `typeMismatch` chỉ so được khi đã có giá trị cũ, nên op `add` thêm phần
    // tử mới lọt hết. Đo thật: model trả
    //   add /activities/- {"name": {"$ref": "/activities/0/name"}, "period": …}
    // — một object kiểu JSON Schema nằm ở chỗ đáng lẽ là chuỗi, cộng thêm field
    // `period` không có trong Profile. Đường dẫn hợp lệ, `value` có mặt, mọi
    // guard cũ cho qua; người dùng tick, bấm Áp dụng, rồi mới vỡ ở tầng dưới.
    //
    // Kiểm bằng chính schema là cách duy nhất bao được mọi hình dạng sai.
    const shapeError = wouldBreakProfile(profile, op)
    if (shapeError) {
      rejected.push({ op, reason: shapeError })
      continue
    }

    // `grounding.ref` trỏ tới tin nhắn KHÔNG có thật nghĩa là model bịa nguồn.
    // Nguy hiểm hơn cả bịa nội dung: giao diện sẽ tick sẵn op đó vì nó "có
    // nguồn từ người dùng".
    if (op.grounding.type === 'user_message' && !validMessageIds.has(op.grounding.ref)) {
      // HẠ xuống `inference`, KHÔNG loại — cùng cách xử lý với số bịa ở dưới.
      //
      // Điều phải bảo đảm là "thứ model bịa không bao giờ hiện ra như đã được
      // xác nhận", và hạ cấp làm đúng việc đó: giao diện không tick sẵn, viền
      // vàng, người dùng tự quyết. Loại hẳn thì bảo đảm thêm được gì đâu, mà
      // lại giết cả lượt: đo thật, model gán `user_message` cho MỌI op khi
      // người dùng gõ một yêu cầu mới thay vì trả lời form, nên cả lô bị loại
      // và họ nhận đúng câu "dẫn nguồn tới tin nhắn không tồn tại" — một lời
      // trách về lỗi của model, phát cho người dùng.
      valid.push({ ...op, grounding: { type: 'inference', ref: op.grounding.ref } })
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

function invalidPathReason(profile: Profile, op: PatchOp): string | null {
  if (pathExists(profile, op.path, op.op)) return null

  const appendPath = missingArrayAppendPath(profile, op.path)
  if (appendPath) {
    return (
      `Đường dẫn "${op.path}" không có trong hồ sơ; nếu muốn thêm mục mới ` +
      `vào cuối mảng, dùng "add ${appendPath}"`
    )
  }
  return `Đường dẫn "${op.path}" không có trong hồ sơ`
}

function missingArrayAppendPath(profile: Profile, pointer: string): string | null {
  const parts = pointer.split('/').slice(1).map(unescapePointer)
  let node: unknown = profile
  const path: string[] = []

  for (const key of parts) {
    if (Array.isArray(node)) {
      const idx = Number(key)
      if (Number.isInteger(idx) && idx >= node.length) {
        return `/${path.map(escapePointer).join('/')}/-`
      }
      node = node[idx]
      path.push(key)
      continue
    }

    if (node === null || typeof node !== 'object') return null
    node = (node as Record<string, unknown>)[key]
    path.push(key)
  }
  return null
}

function sameJsonValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
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

/**
 * Áp thử một op lên bản sao hồ sơ; trả lý do nếu kết quả không còn là Profile hợp lệ.
 *
 * Chạy trên BẢN SAO nên hồ sơ thật không bị đụng tới (BR-53.1). Mỗi op kiểm
 * độc lập với hồ sơ gốc chứ không cộng dồn: người dùng có thể bỏ tick bất kỳ
 * op nào, nên op này không được phép dựa vào op kia đã áp trước đó.
 */
function wouldBreakProfile(profile: Profile, op: PatchOp): string | null {
  const { applyOperation, deepClone } = fastJsonPatch
  let next: unknown
  try {
    next = applyOperation(
      deepClone(profile) as Profile,
      { op: op.op, path: op.path, value: op.value, from: op.from } as never,
      /* validateOperation */ false,
      /* mutateDocument */ true,
    ).newDocument
  } catch {
    return 'Không áp được vào hồ sơ'
  }

  const parsed = ProfileSchema.safeParse(next)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const where = issue?.path.join('/')
    return where ? `Giá trị không đúng dạng ở "${where}"` : 'Giá trị không đúng dạng'
  }

  // Parse THÀNH CÔNG vẫn chưa đủ: Zod LƯỢC BỎ khoá lạ chứ không báo lỗi.
  //
  // Đo thật: model đề xuất `add /summary` (hồ sơ chưa có phần giới thiệu nên
  // nó đoán chỗ). `pathExists` cho qua vì `add` được phép tạo field mới,
  // `safeParse` cũng cho qua vì Zod chỉ lặng lẽ vứt `summary` đi. Op được áp,
  // hệ thống báo "đã áp dụng 1 thay đổi", và nội dung BIẾN MẤT — người dùng
  // nhìn CV không thấy gì, còn log thì nói là xong.
  //
  // Mất dữ liệu mà báo thành công là kiểu hỏng tệ nhất: không ai đi tìm.
  if (op.op === 'add' || op.op === 'replace' || op.op === 'move') {
    const landed = op.path.endsWith('/-')
      ? lastElementPath(parsed.data, op.path)
      : op.path
    if (landed === null) {
      const field = op.path.split('/').filter(Boolean).join('/')
      return `Hồ sơ không có chỗ "${field}" — nội dung sẽ bị mất`
    }

    const after = valueAt(parsed.data, landed)
    if (after === undefined) {
      const field = op.path.split('/').filter(Boolean).join('/')
      return `Hồ sơ không có chỗ "${field}" — nội dung sẽ bị mất`
    }

    // Cả object sống sót vẫn chưa đủ: Zod lược TỪNG KHOÁ lạ bên trong nó.
    //
    // Đo thật khi gom nhóm kỹ năng: model trả
    //   replace /skills/0 {"name":"Python","group":"ML Ops","highlights":[…]}
    // `SkillSchema` không có `highlights`, nên nó bị vứt lặng lẽ. Người dùng
    // nhìn thấy `highlights` trong khung so sánh trước/sau, bấm đồng ý, rồi
    // không nhận được nó — cùng kiểu hỏng với §8.3.11, chỉ nhỏ hơn một bậc.
    const lost = droppedKeys(op.value, after)
    if (lost.length > 0) {
      /*
       * Nói cả field ĐÚNG, không chỉ field sai.
       *
       * Lý do loại op cũng chính là lời nhắc gửi cho model ở lượt sửa (§8.3.7).
       * Bản đầu chỉ nói "Hồ sơ không có trường tech, highlights" — một lời cấm
       * trần trụi. Đo thật trên UC-57: model 4B nghe xong bỏ luôn `group`, thứ
       * nó đang cần, mà vẫn giữ `tech`/`highlights` → lượt sửa cũng loại hết →
       * NO_VALID_OPS. Cấm mà không nói dạng đúng thì model chỉ đổi sang lỗi khác.
       *
       * `allowedFieldsAt` suy ra từ schema nên lời nhắc không lệch khi thêm field.
       */
      const missing = lost.map((k) => `"${k}"`).join(', ')
      const allowed = allowedFieldsAt(landed)
      if (allowed) {
        return (
          `${allowed.label} chỉ có ${allowed.fields.map((f) => `"${f}"`).join(', ')}` +
          ` — bỏ ${missing}`
        )
      }
      return `Hồ sơ không có trường ${missing} — phần đó sẽ bị mất`
    }
  }

  return null
}

/**
 * Làm sạch mọi chuỗi mà NGƯỜI DÙNG sẽ đọc trong một đề xuất.
 *
 * `summary` hiện thành tin nhắn của trợ lý, `rationale` hiện dưới từng op
 * trong modal duyệt — cả hai đều là chữ model viết, và cả hai đều đã lộ con
 * trỏ ra màn hình. Cùng lý do với `reason` của câu hỏi làm rõ.
 */
function cleanProposal(proposal: PatchProposal, rejectedCount = 0): PatchProposal {
  return {
    summary: humanizePointers(
      rejectedCount > 0 ? summarizeValidatedProposal(proposal.ops) : proposal.summary,
    ),
    ops: proposal.ops.map((o) => ({ ...o, rationale: humanizePointers(o.rationale) })),
  }
}

function summarizeValidatedProposal(ops: PatchOp[]): string {
  const count = ops.length
  const labels = [...new Set(ops.map((o) => sectionLabel(o.path)).filter(Boolean))]
  const where = labels.length > 0 ? `: cập nhật ${labels.join(', ')}` : ''
  return `Trợ lý còn ${count} thay đổi có thể áp dụng sau khi kiểm tra${where}.`
}

/**
 * Khoá mà model viết ra nhưng KHÔNG còn sau khi qua schema.
 *
 * Chỉ soi một tầng: đủ để bắt field bịa ra ở mức mục CV, mà không phải đi sâu
 * vào những chỗ schema vốn cho phép tự do.
 */
function droppedKeys(wrote: unknown, kept: unknown): string[] {
  if (wrote === null || typeof wrote !== 'object' || Array.isArray(wrote)) return []
  if (kept === null || typeof kept !== 'object' || Array.isArray(kept)) return []
  const after = kept as Record<string, unknown>
  return Object.keys(wrote as Record<string, unknown>).filter((k) => !(k in after))
}

/**
 * Op `remove` theo CHỈ SỐ vào cùng một mảng — hai lỗi cùng lúc.
 *
 * Đo thật trên UC-57, hồ sơ 24 kỹ năng: model không đủ 20 op để đặt nhóm cho
 * từng kỹ năng, nên nó chọn "xoá hết rồi thêm lại bản đã nhóm" — và bị trần 20
 * op cắt mất toàn bộ phần thêm lại:
 *
 *     remove /skills/0 … remove /skills/19      (không có op `add` nào)
 *     summary: "Đã xoá toàn bộ 20 kỹ năng cũ để chuẩn bị thêm các kỹ năng mới"
 *
 * 1. MẤT DỮ LIỆU. Người dùng bấm đồng ý và mất sạch mục kỹ năng, còn summary
 *    thì hứa một việc không có op nào thực hiện. Vi phạm BR-57.2.
 *
 * 2. LỆCH CHỈ SỐ. `applyProfilePatch` áp op lần lượt, nhưng mọi chỉ số đều tính
 *    trên hồ sơ TRƯỚC patch. Xoá `/skills/0` xong thì `/skills/1` đã trỏ sang
 *    một kỹ năng khác. Người dùng lại được bỏ tick từng op, nên không có thứ
 *    tự nào cứu được. Chỉ dãy xoá GIẢM DẦN là an toàn.
 *
 * Kiểm ở mức PROPOSAL chứ không từng op: một op `remove` đơn lẻ là hợp lệ và
 * hữu ích ("xoá kỹ năng trùng"), chỉ tập hợp mới hỏng.
 */
function unsafeRemovals(ops: PatchOp[]): Map<PatchOp, string> {
  const out = new Map<PatchOp, string>()
  const byArray = new Map<string, PatchOp[]>()

  for (const op of ops) {
    if (op.op !== 'remove') continue
    const m = /^(.*)\/(\d+)$/.exec(op.path)
    if (!m) continue
    const arr = m[1]!
    const list = byArray.get(arr)
    if (list) list.push(op)
    else byArray.set(arr, [op])
  }

  for (const [arr, removes] of byArray) {
    if (removes.length < 2) continue

    const label = sectionLabel(arr) ?? 'mục này'
    const adds = ops.filter(
      (o) => (o.op === 'add' || o.op === 'replace') && o.path.startsWith(`${arr}/`),
    ).length

    // Xoá nhiều hơn thêm lại → net là mất nội dung, bất kể model hứa gì
    const reason =
      adds < removes.length
        ? `Xoá ${removes.length} mục trong "${label}" mà chỉ thêm lại ${adds} — ` +
          `nội dung sẽ mất. Muốn gom nhóm thì đặt field "group" cho từng mục, đừng xoá.`
        : `Nhiều op xoá trong "${label}" cùng lúc: sau op đầu tiên mọi chỉ số đều ` +
          `lệch đi. Mỗi lượt chỉ xoá một phần tử.`

    for (const op of removes) out.set(op, reason)
  }

  return out
}

/** `/work/-` → `/work/2` sau khi đã thêm; `null` nếu chỗ đó không phải mảng. */
function lastElementPath(profile: Profile, pointer: string): string | null {
  const base = pointer.slice(0, -2)
  const arr = valueAt(profile, base)
  if (!Array.isArray(arr) || arr.length === 0) return null
  return `${base}/${arr.length - 1}`
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
      if (idx >= node.length) return false
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

function escapePointer(s: string): string {
  return s.replace(/~/g, '~0').replace(/\//g, '~1')
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
    const res = await deps.gateway.run(insightMiningTask, {
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
    const retry = await deps.gateway.run(proposePatchTask, {
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
    const ask = await deps.gateway.run(insightMiningTask, {
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
