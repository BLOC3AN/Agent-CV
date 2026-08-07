import type { z } from 'zod'

/**
 * Model Gateway — TDD §5.
 * Toàn bộ ứng dụng chỉ biết đúng interface này. Code nghiệp vụ KHÔNG BAO GIỜ
 * biết đang gọi Qwen hay Claude.
 */

export type ProviderKind = 'local' | 'anthropic'

export type ModelAlias =
  | 'reasoner'
  | 'generalist'
  | 'ocr'
  | 'classifier'
  | 'embedder'
  | 'reranker'

/** Định danh đầy đủ, ví dụ "local.reasoner" hoặc "anthropic.deep" */
export type ModelRef = string

export interface CallMeta {
  task: string
  provider: ProviderKind | 'deterministic' | 'none'
  model: string
  latencyMs: number
  promptTokens: number
  completionTokens: number
  schemaValid: boolean
  attempts: number
  escalated: boolean
  /** true khi có phần nội dung bị cắt do ngân sách token (TDD §6.4) */
  truncated: boolean
  /** Các section bị bỏ khi fit budget */
  droppedSections: string[]
}

export type GatewayErrorCode =
  | 'MODEL_UNAVAILABLE'
  | 'CIRCUIT_OPEN'
  | 'TIMEOUT'
  | 'SCHEMA_INVALID'
  | 'BUDGET_EXCEEDED'
  | 'PII_GUARD'
  | 'PROVIDER_DISABLED'
  | 'BAD_INPUT'
  | 'RATE_LIMITED'
  | 'UNKNOWN'

export class GatewayError extends Error {
  constructor(
    public readonly code: GatewayErrorCode,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'GatewayError'
  }
}

export type TaskResult<T> =
  | { ok: true; data: T; meta: CallMeta }
  | { ok: false; error: GatewayError; meta: CallMeta; degraded?: Partial<T> }

// ── Prompt ──────────────────────────────────────────────────────────────────

export interface PromptMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * Một section của prompt, có ngân sách riêng.
 * Thứ tự trong mảng = độ ưu tiên giữ lại (đầu tiên giữ lâu nhất).
 * Xếp theo độ ổn định để tận dụng prefix cache của llama.cpp (TDD §6.6).
 */
export interface PromptSection {
  key: string
  role: PromptMessage['role']
  content: string
  /** Trần token cho section này */
  max: number
  /** Có được phép bỏ hẳn khi thiếu chỗ không */
  droppable: boolean
  /** Hàm nén khi vượt `max` */
  compactor?: (content: string, targetTokens: number) => Promise<string> | string
  /**
   * Nội dung đã được NGƯỜI duyệt, không phải dữ liệu người dùng.
   *
   * Guard PII bỏ qua section này. Lý do: guard tồn tại để chặn PII CỦA NGƯỜI
   * DÙNG rời khỏi hệ thống. Tri thức HR là nội dung biên soạn, có curator ký
   * tên và duyệt trước khi kích hoạt (UC-62) — áp guard dữ liệu người dùng lên
   * nó là nhầm phạm trù.
   *
   * Đo thật: một đoạn KB viết "Đổi sang email dạng họtên@gmail.com" (ví dụ mẫu,
   * không phải email ai cả) làm guard nổ và CHẶN HẲN toàn bộ tính năng tư vấn.
   *
   * Bù lại, PII trong KB được kiểm ở LÚC NẠP (`ingestKbFile`) — một lần, đúng
   * chỗ, và curator thấy cảnh báo trước khi kích hoạt.
   */
  trusted?: boolean
}

export interface BudgetSpec {
  /** Ngân sách làm việc, mặc định 12_000 (TDD §6.1) */
  total: number
  /** Chỗ dành cho output */
  reserveForOutput: number
}

// ── Task ────────────────────────────────────────────────────────────────────

export type SchemaFailPolicy =
  | 'retry_then_escalate'
  | 'retry_then_fail'
  | 'fail_fast'

export interface TaskDefinition<TInput, TOutput> {
  name: string
  /**
   * Input của schema là `unknown`: output model là JSON tuỳ ý, và schema có thể
   * dùng `.default()` khiến input/output khác nhau (ví dụ `yearsRequired`).
   */
  schema: z.ZodType<TOutput, z.ZodTypeDef, unknown>
  buildSections: (input: TInput) => PromptSection[] | Promise<PromptSection[]>
  budget: BudgetSpec
  onSchemaFail: SchemaFailPolicy
  maxRetries: number
  /** Nhiệt độ; mặc định 0 cho task cần ổn định */
  temperature?: number
  /** Trần token output */
  maxTokens?: number
  /**
   * Ghi đè timeout của model cho riêng task này.
   * Cần khi task sinh nhiều token: ở ~35 tok/s, 3500 token output mất ~100s,
   * vượt xa timeout mặc định 60s trong config.yml (TDD §14.1).
   */
  timeoutMs?: number
  /**
   * Ép model sinh đúng schema bằng grammar (mặc định true).
   * Chỉ tắt cho task trả văn xuôi tự do.
   */
  constrainedOutput?: boolean
}

export interface RunOptions {
  signal?: AbortSignal
  onToken?: (chunk: string) => void
  /** Ghi đè model (dùng cho eval/so sánh), bỏ qua routing */
  forceModel?: ModelRef
}

// ── Provider ────────────────────────────────────────────────────────────────

export interface ChatRequest {
  messages: PromptMessage[]
  maxTokens: number
  temperature: number
  signal?: AbortSignal
  onToken?: (chunk: string) => void
  /**
   * Constrained decoding — llama.cpp ép sinh token theo grammar của JSON Schema.
   * Đây là cách duy nhất khiến model 4B trả JSON hợp lệ ổn định (TDD §1.1).
   * Khi bật cloud, ánh xạ sang `output_config.format` của Anthropic.
   */
  jsonSchema?: { name: string; schema: unknown }
}

export interface ChatResponse {
  text: string
  promptTokens: number
  completionTokens: number
}

export interface ChatProvider {
  readonly kind: ProviderKind
  readonly name: string
  chat(req: ChatRequest): Promise<ChatResponse>
  /** Đếm token bằng chính tokenizer của model — KHÔNG ước lượng text.length/4 */
  countTokens(text: string): Promise<number>
  health(): Promise<boolean>
}

export interface EmbedProvider {
  readonly name: string
  readonly dimensions: number
  embed(text: string): Promise<number[]>
  embedBatch(texts: string[]): Promise<number[][]>
  health(): Promise<boolean>
}

export interface RerankResult {
  index: number
  score: number
}

export interface RerankProvider {
  readonly name: string
  rerank(query: string, documents: string[], topN?: number): Promise<RerankResult[]>
  health(): Promise<boolean>
}
