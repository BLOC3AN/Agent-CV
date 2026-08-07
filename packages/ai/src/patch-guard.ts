import fastJsonPatch from 'fast-json-patch'
import {
  allowedFieldsAt,
  PatchOpSchema,
  ProfileSchema,
  type PatchOp,
  type PatchProposal,
  type Profile,
} from '@hr/schema'
import { humanizePointers, sectionLabel } from './paths.js'

/**
 * Chốt chặn giữa model và hồ sơ người dùng — TDD §8.3, BR-53.2.
 *
 * ── Vì sao tách khỏi `chat-flow.ts` ──
 * Hai việc khác hẳn nhau từng nằm chung một file 865 dòng: ĐIỀU PHỐI lượt chat
 * (gọi model mấy lần, theo thứ tự nào) và KIỂM DUYỆT op (op này có phá hồ sơ
 * không, con số này model bịa hay user khai). Chúng không dùng chung state, chỉ
 * gặp nhau ở đúng ba hàm dưới đây.
 *
 * Việc kiểm duyệt là phần đọc nhiều nhất khi truy một op lọt lưới, và phần đó
 * không cần biết gì về gateway hay thứ tự gọi model. Để chung thì mỗi lần đọc
 * phải lội qua phần không liên quan.
 *
 * File này KHÔNG gọi model, không chạm mạng — thuần hàm, test không cần mock.
 */

export interface RejectedOp {
  op: PatchOp
  reason: string
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
export function cleanProposal(proposal: PatchProposal, rejectedCount = 0): PatchProposal {
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

export function unescapePointer(s: string): string {
  return s.replace(/~1/g, '/').replace(/~0/g, '~')
}

function escapePointer(s: string): string {
  return s.replace(/~/g, '~0').replace(/\//g, '~1')
}
