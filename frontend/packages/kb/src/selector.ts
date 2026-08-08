import type { Pool } from 'pg'
import type {
  Citation,
  ContentType,
  KBChunk,
  KBContext,
  KnowledgeSelector,
  SelectedKnowledge,
} from './types.js'

/**
 * `SqlFilterSelector` — chọn tri thức bằng SQL, KHÔNG vector. TDD §10.1, §10.2.
 *
 * > "Một CV chỉ ~1-3K token, nhét thẳng vào 16K context là đủ. RAG trên CV chỉ
 * >  làm mất thông tin do chunking."
 *
 * Lọc theo `(ngành, vai trò, cấp bậc, mục, ngôn ngữ)`, sắp theo `priority`, cắt
 * theo ngân sách token. Deterministic, giải thích được, không tốn lượt gọi model.
 *
 * Khi KB đã lọc vượt ngân sách thường xuyên → đổi sang `HybridRetrievalSelector`
 * (§10.1). `truncated` trong kết quả chính là tín hiệu đó.
 */

interface Row {
  id: string
  source_id: string
  content_type: ContentType
  text: string
  breadcrumb: string | null
  industry: string[]
  role_family: string[]
  seniority: string[]
  section: string[]
  language: string
  token_count: number | null
  priority: number
}

function toChunk(r: Row): KBChunk {
  return {
    id: r.id,
    sourceId: r.source_id,
    contentType: r.content_type,
    text: r.text,
    breadcrumb: r.breadcrumb,
    industry: r.industry ?? [],
    roleFamily: r.role_family ?? [],
    seniority: r.seniority ?? [],
    section: r.section ?? [],
    language: r.language,
    tokenCount: r.token_count,
    priority: r.priority,
  }
}

/**
 * Số token của một đoạn. Thiếu `token_count` thì ước lượng — thà ước lượng còn
 * hơn coi như 0 và để prompt vượt ngân sách.
 */
function tokensOf(c: KBChunk): number {
  return c.tokenCount ?? Math.ceil((c.text.length / 4) * (c.language === 'vi' ? 1.29 : 1))
}

export class SqlFilterSelector implements KnowledgeSelector {
  constructor(private readonly pool: Pool) {}

  async select(ctx: KBContext, budgetTokens: number): Promise<SelectedKnowledge> {
    const sections = ctx.sections ?? []

    // `role_family` và `seniority` chứa 'all' nghĩa là áp dụng cho mọi trường
    // hợp — dùng `&&` (giao nhau) với danh sách có thêm 'all'.
    //
    // Mảng RỖNG cũng tính là "áp dụng cho mọi trường hợp": người viết KB không
    // ghi phạm vi nghĩa là không giới hạn, chứ không phải "không áp dụng cho
    // ai". Hiểu ngược lại sẽ làm mất im lặng phần lớn tri thức.
    const { rows } = await this.pool.query<Row>(
      `SELECT c.id, c.source_id, c.content_type, c.text, c.breadcrumb,
              c.industry, c.role_family, c.seniority, c.section,
              c.language, c.token_count, c.priority
         FROM kb_chunks c
         JOIN kb_sources s ON s.id = c.source_id
        WHERE s.status = 'active'
          AND c.language = $1
          AND (cardinality(c.industry)    = 0 OR c.industry    && $2::text[])
          AND (cardinality(c.role_family) = 0 OR c.role_family && $3::text[])
          AND (cardinality(c.seniority)   = 0 OR c.seniority   && $4::text[])
          AND (cardinality(c.section)     = 0 OR $5::text[] = '{}'::text[]
               OR c.section && $5::text[])
        ORDER BY c.priority DESC, c.id`,
      [
        ctx.language,
        [ctx.industry, 'all'],
        [ctx.roleFamily, 'all'],
        [ctx.seniority, 'all'],
        sections,
      ],
    )

    const all = rows.map(toChunk)

    // Cắt theo ngân sách, ưu tiên cao giữ trước (§6.4). Đã sắp theo `priority`
    // ở SQL nên chỉ cần cộng dồn.
    const kept: KBChunk[] = []
    let used = 0
    let truncated = false
    for (const c of all) {
      const t = tokensOf(c)
      if (used + t > budgetTokens) {
        truncated = true
        continue
      }
      kept.push(c)
      used += t
    }

    return {
      guidelines: kept.filter((c) => c.contentType === 'guideline'),
      exemplars: kept.filter((c) => c.contentType === 'exemplar'),
      redFlags: kept.filter((c) => c.contentType === 'red_flag'),
      clarifyingQuestions: kept.filter((c) => c.contentType === 'clarifying_question'),
      tokensUsed: used,
      strategy: 'context_injection',
      truncated,
    }
  }

  /**
   * Trích dẫn cho các đoạn đã dùng — §10.4.
   *
   * Giao diện hiển thị "Theo [Tên] — [Chức danh]" kèm trích đoạn gốc. Lời
   * khuyên KHÔNG có trích dẫn được gắn nhãn "gợi ý chung của AI" và hiện khác
   * màu; ranh giới đó vừa tạo niềm tin vừa là công cụ gỡ lỗi.
   */
  async citations(refs: string[], language: 'vi' | 'en' = 'vi'): Promise<Citation[]> {
    if (refs.length === 0) return []

    // Nhận CẢ HAI dạng: breadcrumb (model trích) và UUID (code nội bộ dùng).
    // Ép một dạng duy nhất sẽ làm trích dẫn im lặng biến mất khi ai đó truyền
    // dạng kia — mà "im lặng biến mất" là đúng thứ §10.4 muốn tránh.
    const uuids = refs.filter((r) => /^[0-9a-f-]{36}$/i.test(r))
    const slugs = refs.filter((r) => !/^[0-9a-f-]{36}$/i.test(r))

    const { rows } = await this.pool.query<{
      id: string
      breadcrumb: string | null
      text: string
      title: string
      author_name: string
      author_title: string | null
    }>(
      `SELECT c.id, c.breadcrumb, c.text, s.title, s.author_name, s.author_title
         FROM kb_chunks c JOIN kb_sources s ON s.id = c.source_id
        WHERE (c.id = ANY($1::uuid[]) OR c.breadcrumb = ANY($2::text[]))
          -- Lọc ngôn ngữ: mỗi đoạn được nạp thành hai bản (vi + en) cùng
          -- breadcrumb. Thiếu điều kiện này thì báo cáo hiện trích dẫn TRÙNG,
          -- một bản tiếng Việt một bản tiếng Anh cho cùng một lời khuyên.
          AND c.language = $3`,
      [uuids, slugs, language],
    )

    return rows.map((r) => ({
      chunkId: r.breadcrumb ?? r.id,
      sourceTitle: r.title,
      authorName: r.author_name,
      authorTitle: r.author_title,
      excerpt: r.text.length > 300 ? `${r.text.slice(0, 299)}…` : r.text,
    }))
  }
}

/**
 * Dạng gọn để nhét vào prompt.
 *
 * Dùng `breadcrumb` (mã người đặt: `g_bullet_formula`) làm id trích dẫn, KHÔNG
 * dùng UUID.
 *
 * Đo thật: với UUID, model 4B trích dẫn được **0/11** lời khuyên — chép chính
 * xác 36 ký tự hex là việc nó làm rất tệ, và sai một ký tự thì trích dẫn thành
 * vô nghĩa. Mã ngắn có nghĩa thì nó chép đúng, và người đọc log cũng hiểu ngay
 * lời khuyên đến từ đâu.
 *
 * UUID vẫn là khoá chính trong DB; `citations()` tra ngược từ breadcrumb.
 */
export function toPromptChunks(k: SelectedKnowledge): { id: string; text: string }[] {
  return [...k.guidelines, ...k.exemplars, ...k.redFlags].map((c) => ({
    id: c.breadcrumb ?? c.id,
    text: c.text,
  }))
}

/** Câu hỏi làm rõ — `insight_mining` dùng lại thay vì tự nghĩ (UC-52 bước 2). */
export function toClarifyQuestions(k: SelectedKnowledge): string[] {
  return k.clarifyingQuestions
    .flatMap((c) => c.text.split('\n'))
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2).trim())
    .filter(Boolean)
}
