import { z } from 'zod'

/**
 * PatchProposalSchema — TDD §8.3, UC-53.
 *
 * Quy tắc cứng: AI KHÔNG BAO GIỜ ghi thẳng vào Profile. AI chỉ đề xuất patch,
 * user duyệt từng op. `grounding` là guardrail chống hallucination.
 */

export const JsonPointerSchema = z
  .string()
  .regex(/^(\/[^/~]*(~[01][^/~]*)*)*$/, 'Không phải JSON Pointer hợp lệ (RFC 6901)')

/**
 * Nguồn gốc của một thay đổi. Quyết định UI có tick sẵn checkbox hay không:
 *  - user_message / existing_field / kb  → tick sẵn
 *  - inference                           → KHÔNG tick sẵn, viền vàng cảnh báo
 */
export const GroundingTypeSchema = z.enum([
  'user_message',
  'existing_field',
  'kb',
  'inference',
])
export type GroundingType = z.infer<typeof GroundingTypeSchema>

export const GroundingSchema = z.object({
  type: GroundingTypeSchema,
  /** message_id, JSON Pointer, hoặc kb_chunk_id tuỳ theo type */
  ref: z.string().min(1),
})

/**
 * Giá trị mới của một op.
 *
 * ── Vì sao KHÔNG dùng `z.unknown()` ──
 * `z.unknown()` biến thành `{}` trong JSON Schema và KHÔNG BAO GIỜ vào danh
 * sách `required`. llama.cpp dựng grammar từ đó, nên grammar tự nói với model
 * rằng "value" là tuỳ chọn — và model 4B bỏ đi thật. Người dùng nhận đúng lỗi
 * `op "replace" thiếu "value"` sau khi đã tick và bấm Áp dụng.
 *
 * Liệt kê tường minh các kiểu JSON làm `value` thành BẮT BUỘC trong grammar.
 * `null` nằm trong danh sách để `remove` có thứ hợp lệ để điền.
 */
export const PatchValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.unknown()),
  z.record(z.unknown()),
])

export const PatchOpSchema = z.object({
  op: z.enum(['add', 'remove', 'replace', 'move']),
  path: JsonPointerSchema,
  value: z.unknown().optional(),
  from: JsonPointerSchema.optional(),
  /** Bắt buộc — hiển thị cho user biết vì sao đề xuất thay đổi này */
  rationale: z.string().min(10),
  grounding: GroundingSchema,
  kbRefs: z.array(z.string()).default([]),
})

export type PatchOp = z.infer<typeof PatchOpSchema>

export const PatchProposalSchema = z.object({
  ops: z.array(PatchOpSchema).min(1).max(20),
  summary: z.string(),
})

/**
 * Dạng op mà MODEL phải trả về — khác dạng lưu trữ ở đúng một điểm: `value`
 * bắt buộc.
 *
 * Tách riêng vì hai schema phục vụ hai việc khác nhau. Bản lưu trữ phải cho
 * `value` vắng mặt (op `remove` không có giá trị mới, RFC 6902). Bản gửi model
 * thì không được, vì "được phép vắng" trong grammar nghĩa là model SẼ bỏ.
 */
export const WirePatchOpSchema = PatchOpSchema.extend({
  value: PatchValueSchema,
})

export const WirePatchProposalSchema = z.object({
  ops: z.array(WirePatchOpSchema).min(1).max(20),
  summary: z.string(),
})

export type PatchProposal = z.infer<typeof PatchProposalSchema>

/** Trạng thái sau khi user duyệt */
export const PatchStatusSchema = z.enum([
  'pending',
  'accepted',
  'rejected',
  'partial',
])
export type PatchStatus = z.infer<typeof PatchStatusSchema>

/** Kết quả của task `plan_agent_step` — schema NHỎ cho model 4B (TDD §5.2) */
export const AgentPlanSchema = z.object({
  intent: z.enum([
    'rewrite_section',
    'add_content',
    'remove_content',
    'ask_question',
    'explain',
    'other',
  ]),
  targetPath: JsonPointerSchema.nullable().default(null),
  needsInfo: z.array(z.string()).max(3).default([]),
})

export type AgentPlan = z.infer<typeof AgentPlanSchema>

/** Câu hỏi làm rõ — UC-52. AI hỏi thay vì bịa số. */
export const ClarifyQuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  placeholder: z.string().optional(),
})

export const ClarifyRequestSchema = z.object({
  reason: z.string(),
  targetPath: JsonPointerSchema,
  questions: z.array(ClarifyQuestionSchema).min(1).max(3),
})

export type ClarifyRequest = z.infer<typeof ClarifyRequestSchema>
