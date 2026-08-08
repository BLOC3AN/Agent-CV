import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import type { Pool } from 'pg'
import type { ContentType } from './types.js'

/**
 * Nạp KB từ file YAML vào Postgres — UC-61, TDD §10.
 *
 * Nguồn là YAML chứ không phải giao diện nhập liệu: người đóng góp tri thức là
 * chuyên gia HR, không phải người dùng cuối. Họ sửa file, gửi lại, và mọi thay
 * đổi có lịch sử qua git — điều mà một form web không cho được.
 */

const Bilingual = z.object({ vi: z.string(), en: z.string().optional() })

/**
 * Chấp nhận cả `section: basics` lẫn `section: [basics]`.
 *
 * File KB do chuyên gia HR viết tay, và cùng một file thật đã có cả hai cách
 * viết. Bắt họ nhớ đúng cú pháp YAML là đặt sai gánh nặng: người biết về tuyển
 * dụng không cần biết khác nhau giữa scalar và sequence.
 */
const StringList = z
  .union([z.string(), z.array(z.string())])
  .default([])
  .transform((v) => (typeof v === 'string' ? [v] : v))


const SourceSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  // Cho phép null Ở FILE để bản seed tồn tại được khi chưa có HR nào duyệt,
  // nhưng `ingest` sẽ TỪ CHỐI nạp vào trạng thái `active` nếu thiếu tên.
  author_name: z.string().nullable().default(null),
  author_title: z.string().nullable().default(null),
  language: z.string().default('vi'),
  status: z.enum(['draft', 'pending_review', 'active', 'archived']).default('draft'),
  version: z.number().int().default(0),
  scope: z
    .object({
      industry: z.array(z.string()).default([]),
      role_family: StringList,
      seniority: StringList,
    })
    .default({ industry: [], role_family: [], seniority: [] }),
})

/** Danh sách câu hỏi: có thể là mảng thuần, hoặc song ngữ. */
const QuestionList = z.union([
  z.array(z.string()),
  z.object({ vi: z.array(z.string()), en: z.array(z.string()).optional() }),
])

const ChunkSchema = z.object({
  // `clarifying_questions` trong KB thật không có `id`, chỉ có `trigger` —
  // dùng `trigger` làm khoá thay thế. Bắt buộc `id` sẽ chặn nạp cả nhóm đó.
  id: z.string().optional(),
  section: StringList,
  role_family: StringList,
  seniority: StringList,
  priority: z.number().int().default(50),
  text: Bilingual.optional(),
  // `red_flags` và `clarifying_questions` dùng tên field khác
  message: Bilingual.optional(),
  detector: z.string().optional(),
  questions: QuestionList.optional(),
  trigger: z.string().optional(),
  // `exemplars` có cặp trước/sau
  before: z.string().optional(),
  after: z.string().optional(),
  why: Bilingual.optional(),
})

const FileSchema = z.object({
  source: SourceSchema,
  guidelines: z.array(ChunkSchema).default([]),
  exemplars: z.array(ChunkSchema).default([]),
  red_flags: z.array(ChunkSchema).default([]),
  clarifying_questions: z.array(ChunkSchema).default([]),
})

export interface IngestResult {
  sourceId: string
  inserted: number
  skipped: { id: string; reason: string }[]
  status: string
  /**
   * Đoạn có nội dung TRÔNG GIỐNG PII — curator phải xem trước khi kích hoạt.
   *
   * Kiểm ở đây chứ không ở guard lúc gửi prompt: KB là nội dung biên soạn, kiểm
   * mỗi lượt gọi vừa tốn vừa sai phạm trù. Và phần lớn báo động là ví dụ mẫu
   * ("Đổi sang email dạng họtên@gmail.com") — thứ chỉ NGƯỜI mới phân biệt được
   * với PII thật.
   */
  piiWarnings: { id: string; kind: string; sample: string }[]
}

/** Mẫu PII tối thiểu để cảnh báo curator. Cố ý ĐƠN GIẢN — đây là gợi ý cho
 * người đọc, không phải chốt chặn tự động. */
const PII_HINTS: [string, RegExp][] = [
  ['email', /[\w.+-]+@[\w-]+\.[\w.]{2,}/],
  ['phone', /(?<![\d+])(?:\(\s*\+?84\s*\)|\+\s*84|0)[\s.-]*[35789][\d\s.-]{7,11}\d/],
]

/** Ước lượng token: tiếng Việt tốn ~1.29× tiếng Anh (đo ở TDD §6.1). */
function estimateTokens(text: string, language: string): number {
  const base = Math.ceil(text.length / 4)
  return language === 'vi' ? Math.ceil(base * 1.29) : base
}

/**
 * Dựng text hiển thị cho một đoạn tri thức.
 *
 * Bốn loại có hình dạng khác nhau trong YAML nhưng cùng đi vào một cột `text`:
 * prompt chỉ cần đọc được, không cần biết nó vốn là guideline hay exemplar.
 * Kiểu gốc vẫn giữ ở `content_type` để lọc.
 */
function renderText(
  kind: ContentType,
  c: z.infer<typeof ChunkSchema>,
  lang: 'vi' | 'en',
): string | null {
  const pick = (b?: { vi: string; en?: string }): string =>
    (lang === 'en' ? (b?.en ?? b?.vi) : b?.vi) ?? ''

  if (kind === 'guideline') return pick(c.text).trim() || null

  if (kind === 'exemplar') {
    if (!c.before || !c.after) return null
    const why = pick(c.why)
    return [
      lang === 'en' ? 'Weak:' : 'Chưa tốt:',
      c.before,
      lang === 'en' ? 'Better:' : 'Tốt hơn:',
      c.after,
      why ? (lang === 'en' ? `Why: ${why}` : `Vì sao: ${why}`) : '',
    ]
      .filter(Boolean)
      .join('\n')
      .trim()
  }

  if (kind === 'red_flag') {
    const msg = pick(c.message)
    if (!msg) return null
    return c.detector ? `[${c.detector}]\n${msg}` : msg
  }

  // clarifying_question
  const qs = Array.isArray(c.questions)
    ? c.questions
    : lang === 'en'
      ? (c.questions?.en ?? c.questions?.vi ?? [])
      : (c.questions?.vi ?? [])
  if (qs.length === 0) return null
  const head = c.trigger ? `(${c.trigger})\n` : ''
  return head + qs.map((q) => `- ${q}`).join('\n')
}

/**
 * Nạp một file KB.
 *
 * Idempotent theo `source.id`: chạy lại sau khi sửa file sẽ THAY TOÀN BỘ đoạn
 * của nguồn đó. Nếu chỉ thêm mới, đoạn đã xoá khỏi file vẫn nằm lại trong DB
 * và tiếp tục xuất hiện trong lời khuyên — một dạng "ma" rất khó lần ra.
 */
export async function ingestKbFile(pool: Pool, path: string): Promise<IngestResult> {
  const raw = parseYaml(readFileSync(path, 'utf8')) as unknown
  const file = FileSchema.parse(raw)
  const src = file.source

  // §10.4: mọi lời khuyên phải trích dẫn được về một người thật. Nguồn không
  // có tên tác giả thì KHÔNG được đưa vào trạng thái `active`.
  if (src.status === 'active' && !src.author_name) {
    throw new Error(
      `Nguồn "${src.id}" đặt status: active nhưng thiếu author_name. ` +
        'Mọi lời khuyên phải trích dẫn được về một người thật (TDD §10.4).',
    )
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO kb_sources (slug, title, author_name, author_title, language, status, version)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT ON CONSTRAINT kb_sources_slug_key DO UPDATE
         SET title = EXCLUDED.title,
             author_name = EXCLUDED.author_name,
             author_title = EXCLUDED.author_title,
             status = EXCLUDED.status,
             version = EXCLUDED.version
       RETURNING id`,
      [
        src.id,
        src.title,
        // Chưa có HR nào duyệt thì ghi rõ, đừng để rỗng — cột là NOT NULL và
        // chuỗi rỗng sẽ hiện thành "Theo  — " trên giao diện
        src.author_name ?? 'Chưa có người duyệt',
        src.author_title,
        src.language,
        src.status,
        src.version,
      ],
    )
    const sourceId = rows[0]!.id

    // Xoá sạch đoạn cũ của nguồn này rồi nạp lại — xem chú thích ở đầu hàm
    await client.query('DELETE FROM kb_chunks WHERE source_id = $1', [sourceId])

    const groups: [ContentType, z.infer<typeof ChunkSchema>[]][] = [
      ['guideline', file.guidelines],
      ['exemplar', file.exemplars],
      ['red_flag', file.red_flags],
      ['clarifying_question', file.clarifying_questions],
    ]

    let inserted = 0
    const skipped: IngestResult['skipped'] = []
    const piiWarnings: IngestResult['piiWarnings'] = []

    for (const [kind, list] of groups) {
      for (const c of list) {
        // Nạp CẢ HAI ngôn ngữ thành hai đoạn riêng: lọc theo `language` ở
        // selector rẻ hơn nhiều so với dịch lúc chạy
        const key = c.id ?? c.trigger ?? `${kind}-${inserted}`
        for (const lang of ['vi', 'en'] as const) {
          const text = renderText(kind, c, lang)
          if (!text) {
            if (lang === 'vi') skipped.push({ id: key, reason: `${kind}: thiếu nội dung` })
            continue
          }

          await client.query(
            `INSERT INTO kb_chunks
               (source_id, content_type, text, breadcrumb, industry, role_family,
                seniority, section, language, token_count, priority)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [
              sourceId,
              kind,
              text,
              key,
              src.scope.industry,
              // `role_family: [all]` nghĩa là áp dụng cho mọi vai trò — giữ
              // nguyên chuỗi "all" và xử lý ở truy vấn, đừng bung ra danh sách
              // vì danh sách vai trò sẽ dài thêm theo thời gian
              c.role_family.length ? c.role_family : src.scope.role_family,
              c.seniority.length ? c.seniority : src.scope.seniority,
              c.section,
              lang,
              estimateTokens(text, lang),
              c.priority,
            ],
          )
          inserted++

          if (lang === 'vi') {
            for (const [kind, re] of PII_HINTS) {
              const m = re.exec(text)
              if (m) piiWarnings.push({ id: key, kind, sample: m[0] })
            }
          }
        }
      }
    }

    await client.query('COMMIT')
    return { sourceId, inserted, skipped, status: src.status, piiWarnings }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
