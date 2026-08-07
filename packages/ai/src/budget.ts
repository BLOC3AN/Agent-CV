import { createHash } from 'node:crypto'
import type { BudgetSpec, PromptMessage, PromptSection } from './types.js'
import { GatewayError } from './types.js'

/**
 * Quản lý ngân sách context — TDD §6.
 *
 * Ràng buộc đo được (TDD §2.2, §2.3):
 *   · Context vật lý reasoner : 16_384 (đã kiểm chứng đẩy 15_620 prompt token OK)
 *   · Đệm tranh chấp 4 slot   :  4_384
 *   · NGÂN SÁCH LÀM VIỆC      : 12_000
 *   · Tiếng Việt tốn 1.29× token so với tiếng Anh
 */

export const WORKING_BUDGET = 12_000
export const PHYSICAL_CTX = 16_384
export const SLOT_RESERVE = PHYSICAL_CTX - WORKING_BUDGET

export const DEFAULT_BUDGET: BudgetSpec = {
  total: WORKING_BUDGET,
  reserveForOutput: 2_000,
}

// ── Đếm token ───────────────────────────────────────────────────────────────

export type TokenCounter = (text: string) => Promise<number>

/**
 * TDD §6.3: "Không ước lượng bằng text.length / 4. Dùng chính tokenizer của model."
 * Cache theo hash nội dung — Profile và JD không đổi trong một session.
 */
export class CachingTokenCounter {
  private cache = new Map<string, number>()

  constructor(
    private readonly counter: TokenCounter,
    private readonly maxEntries = 500,
  ) {}

  async count(text: string): Promise<number> {
    const key = createHash('sha1').update(text).digest('hex')
    const hit = this.cache.get(key)
    if (hit !== undefined) return hit
    const n = await this.counter(text)
    if (this.cache.size >= this.maxEntries) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) this.cache.delete(oldest)
    }
    this.cache.set(key, n)
    return n
  }

  get size(): number {
    return this.cache.size
  }

  clear(): void {
    this.cache.clear()
  }
}

// ── Kết quả fit ─────────────────────────────────────────────────────────────

export interface FitResult {
  messages: PromptMessage[]
  promptTokens: number
  /** true khi có section bị nén hoặc bị cắt — UI PHẢI cảnh báo (TDD §6.4) */
  truncated: boolean
  droppedSections: string[]
  compactedSections: string[]
}

/**
 * Ép các section vào ngân sách theo chiến lược TDD §6.4, đúng thứ tự:
 *   1. Nén section có compactor (theo thứ tự ngược — ưu tiên thấp nén trước)
 *   2. Bỏ section droppable (theo thứ tự ngược)
 *   3. Vẫn vượt → NÉM BUDGET_EXCEEDED
 *
 * CẤM: cắt cụt giữa chừng rồi vẫn gửi. Section non-droppable không có compactor
 * mà vượt max thì đó là lỗi thiết kế task, phải chia nhỏ task (TDD §6.4 bước 5).
 */
export async function fitBudget(
  sections: PromptSection[],
  budget: BudgetSpec,
  counter: CachingTokenCounter,
): Promise<FitResult> {
  const limit = budget.total - budget.reserveForOutput
  if (limit <= 0) {
    throw new GatewayError(
      'BUDGET_EXCEEDED',
      `reserveForOutput (${budget.reserveForOutput}) >= total (${budget.total})`,
    )
  }

  const working = sections.map((s) => ({ ...s, dropped: false }))
  const compacted: string[] = []
  const dropped: string[] = []

  const measure = async (): Promise<number> => {
    let sum = 0
    for (const s of working) {
      if (s.dropped) continue
      sum += await counter.count(s.content)
    }
    return sum
  }

  // Bước 0 — mỗi section tự vượt `max` thì nén trước, bất kể tổng
  for (const s of working) {
    const n = await counter.count(s.content)
    if (n > s.max && s.compactor) {
      s.content = await s.compactor(s.content, s.max)
      compacted.push(s.key)
    }
  }

  let total = await measure()
  if (total <= limit) {
    return {
      messages: toMessages(working),
      promptTokens: total,
      truncated: compacted.length > 0,
      droppedSections: [],
      compactedSections: compacted,
    }
  }

  // Bước 1 — nén, ưu tiên thấp trước (duyệt ngược mảng)
  for (let i = working.length - 1; i >= 0 && total > limit; i--) {
    const s = working[i]!
    if (s.dropped || !s.compactor) continue
    const current = await counter.count(s.content)
    const need = total - limit
    const target = Math.max(1, current - need)
    s.content = await s.compactor(s.content, target)
    if (!compacted.includes(s.key)) compacted.push(s.key)
    total = await measure()
  }

  // Bước 2 — bỏ hẳn section droppable, ưu tiên thấp trước
  for (let i = working.length - 1; i >= 0 && total > limit; i--) {
    const s = working[i]!
    if (!s.droppable || s.dropped) continue
    s.dropped = true
    dropped.push(s.key)
    total = await measure()
  }

  // Bước 3 — vẫn vượt: KHÔNG cắt bừa, báo lỗi để tầng trên chia nhỏ task
  if (total > limit) {
    throw new GatewayError(
      'BUDGET_EXCEEDED',
      `Prompt ${total} token vượt ngân sách ${limit} sau khi đã nén và bỏ ` +
        `section. Cần chia nhỏ task (TDD §6.4 bước 5). ` +
        `Đã nén: [${compacted.join(', ')}]. Đã bỏ: [${dropped.join(', ')}].`,
    )
  }

  return {
    messages: toMessages(working),
    promptTokens: total,
    truncated: compacted.length > 0 || dropped.length > 0,
    droppedSections: dropped,
    compactedSections: compacted,
  }
}

/**
 * Gộp section thành message, GIỮ NGUYÊN THỨ TỰ.
 * TDD §6.6 — thứ tự quyết định prefix cache của llama.cpp:
 *   [system+hướng dẫn] [profile] [jd] ── ranh giới ổn định ── [kb] [history] [câu hỏi]
 * Đặt sai thứ tự (ví dụ nhét timestamp vào system) → mất toàn bộ prefix cache.
 */
function toMessages(
  sections: (PromptSection & { dropped: boolean })[],
): PromptMessage[] {
  const out: PromptMessage[] = []
  for (const s of sections) {
    if (s.dropped || s.content.trim() === '') continue
    const last = out[out.length - 1]
    if (last && last.role === s.role) {
      last.content += '\n\n' + s.content
    } else {
      out.push({ role: s.role, content: s.content })
    }
  }
  return out
}

// ── Compactor dùng lại được ─────────────────────────────────────────────────

/**
 * Cắt theo đơn vị dòng, giữ phần đầu. Dùng cho KB (bỏ chunk ưu tiên thấp).
 * Ước lượng ký tự/token theo ngôn ngữ để giảm số lần gọi /tokenize.
 */
export function makeLineTrimmer(charsPerToken = 3): PromptSection['compactor'] {
  return (content, targetTokens) => {
    const budgetChars = Math.max(1, targetTokens * charsPerToken)
    if (content.length <= budgetChars) return content
    const lines = content.split('\n')
    const kept: string[] = []
    let used = 0
    for (const line of lines) {
      if (used + line.length + 1 > budgetChars) break
      kept.push(line)
      used += line.length + 1
    }
    return kept.join('\n')
  }
}

/** Tỉ lệ token tiếng Việt / tiếng Anh — đo thực tế trên reasoner (TDD §2.3) */
export const VI_EN_TOKEN_RATIO = 1.29
