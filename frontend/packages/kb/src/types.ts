import { z } from 'zod'

/**
 * Knowledge Base — TDD §10.
 *
 * Nguyên tắc quyết định toàn bộ thiết kế: **mọi lời khuyên phải trích dẫn được
 * về một người thật** (§10.4). Vì vậy `author_name` là bắt buộc ở tầng lược đồ,
 * và mỗi đoạn tri thức luôn mang theo id để lời khuyên dẫn nguồn.
 */

export type ContentType = 'guideline' | 'exemplar' | 'red_flag' | 'clarifying_question'

export const KBChunkSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  contentType: z.enum(['guideline', 'exemplar', 'red_flag', 'clarifying_question']),
  text: z.string().min(1),
  breadcrumb: z.string().nullable().default(null),
  industry: z.array(z.string()).default([]),
  roleFamily: z.array(z.string()).default([]),
  seniority: z.array(z.string()).default([]),
  section: z.array(z.string()).default([]),
  language: z.string().default('vi'),
  tokenCount: z.number().int().nullable().default(null),
  priority: z.number().int().default(50),
})

export type KBChunk = z.infer<typeof KBChunkSchema>

export interface KBSource {
  id: string
  title: string
  /** BẮT BUỘC — không có tên thì không hiện được "Theo [Tên] — [Chức danh]" */
  authorName: string
  authorTitle: string | null
  language: string
  status: 'draft' | 'pending_review' | 'active' | 'archived'
  version: number
}

/** Ngữ cảnh để chọn tri thức — TDD §10.2. */
export interface KBContext {
  industry: string
  roleFamily: string
  seniority: string
  /** Mục CV đang xét: work, projects, skills… Rỗng = mọi mục. */
  sections?: string[]
  language: 'vi' | 'en'
  /** Chỉ `HybridRetrievalSelector` dùng; `SqlFilterSelector` bỏ qua. */
  query?: string
}

export interface SelectedKnowledge {
  guidelines: KBChunk[]
  exemplars: KBChunk[]
  redFlags: KBChunk[]
  clarifyingQuestions: KBChunk[]
  tokensUsed: number
  strategy: 'context_injection' | 'hybrid_retrieval'
  /**
   * Có đoạn nào bị cắt vì hết ngân sách không.
   *
   * Cần biết để cảnh báo: KB lọc ra mà vẫn vượt ngân sách là tín hiệu phải
   * chuyển sang `hybrid_retrieval` (§10.1), không phải chuyện âm thầm bỏ bớt.
   */
  truncated: boolean
}

/**
 * Interface KHÔNG ĐỔI giữa hai chiến lược — TDD §10.2.
 *
 * Giai đoạn 1 dùng `SqlFilterSelector`. Khi KB lớn lên, đổi sang
 * `HybridRetrievalSelector` bằng cách sửa config, không sửa code gọi.
 */
export interface KnowledgeSelector {
  select(ctx: KBContext, budgetTokens: number): Promise<SelectedKnowledge>
}

/** Trích dẫn hiển thị cho user — §10.4. */
export interface Citation {
  chunkId: string
  sourceTitle: string
  authorName: string
  authorTitle: string | null
  excerpt: string
}
