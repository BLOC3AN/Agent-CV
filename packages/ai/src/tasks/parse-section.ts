import { z } from 'zod'
import {
  EducationSchema,
  WorkSchema,
  ProjectSchema,
  SkillSchema,
  ActivitySchema,
  CertificationSchema,
  LanguageSkillSchema,
  type Language,
} from '@hr/schema'
import { defineTask } from '../gateway.js'
import type { PromptSection, TaskDefinition } from '../types.js'

/**
 * Parse MỘT mục của CV — TDD §6.4 bước 5 ("chia nhỏ task").
 *
 * Vì sao không parse cả CV một lượt: đo thực tế trên CV-01 (3000 ký tự), model
 * 4B trả `education: []` dù mục EDUCATION nằm nguyên trong text. Đưa riêng đoạn
 * đó thì parse đúng 3/3 lần, deterministic. Mất chú ý theo độ dài, không phải
 * lỗi schema.
 *
 * Lợi ích kèm theo: schema nhỏ → grammar đơn giản → nhanh hơn và ít hỏng hơn;
 * và một mục hỏng không kéo đổ cả CV.
 */

export type ParseableSection =
  | 'education'
  | 'work'
  | 'projects'
  | 'skills'
  | 'activities'
  | 'certifications'
  | 'languages'

const SCHEMAS = {
  education: z.object({ items: z.array(EducationSchema).default([]) }),
  work: z.object({ items: z.array(WorkSchema).default([]) }),
  projects: z.object({ items: z.array(ProjectSchema).default([]) }),
  skills: z.object({ items: z.array(SkillSchema).default([]) }),
  activities: z.object({ items: z.array(ActivitySchema).default([]) }),
  certifications: z.object({ items: z.array(CertificationSchema).default([]) }),
  languages: z.object({ items: z.array(LanguageSkillSchema).default([]) }),
} as const

const LABEL: Record<ParseableSection, { vi: string; en: string }> = {
  education: { vi: 'học vấn', en: 'education' },
  work: { vi: 'kinh nghiệm làm việc', en: 'work experience' },
  projects: { vi: 'dự án', en: 'projects' },
  skills: { vi: 'kỹ năng', en: 'skills' },
  activities: { vi: 'hoạt động', en: 'activities' },
  certifications: { vi: 'chứng chỉ', en: 'certifications' },
  languages: { vi: 'ngoại ngữ', en: 'languages' },
}

/**
 * Luật riêng cho từng loại mục, thêm vào cuối prompt chung.
 *
 * Chỉ thêm khi có bằng chứng model làm sai — prompt dài hơn thì tốn token và
 * làm loãng các luật quan trọng khác.
 */
const EXTRA_RULES: Partial<Record<ParseableSection, { vi: string; en: string }>> = {
  work: {
    // Đo trên CV-07 thật: một chỗ làm chứa nhiều dự án, mỗi dự án có tiêu đề
    // riêng nhìn y hệt tên công ty:
    //     SPLUS — Software          12/2025 – Present
    //     Fullstack Developer
    //     • …
    //     Backend Developer — System Modernization      ← DỰ ÁN, không phải công ty
    //     • …
    // Model tách thành 5 "chỗ làm" trong khi CV chỉ có 2. Hồ sơ thành ra nói
    // người này nhảy việc 5 lần — sai lệch nghiêm trọng với nhà tuyển dụng.
    vi: `
QUAN TRỌNG — một chỗ làm có thể chứa nhiều dự án:
    SPLUS — Software        12/2025 – Hiện tại
    Fullstack Developer
    • …
    Backend Developer — System Modernization
    • …

Khối KHÔNG CÓ mốc thời gian riêng là DỰ ÁN thuộc chỗ làm ngay phía trên, KHÔNG
phải một chỗ làm mới. Gộp gạch đầu dòng của nó vào "highlights" của chỗ làm đó.
Chỉ mở một mục mới khi thấy MỐC THỜI GIAN mới.`,
    en: `
IMPORTANT — one employer may contain several projects:
    SPLUS — Software        12/2025 – Present
    Fullstack Developer
    • …
    Backend Developer — System Modernization
    • …

A block with NO date range of its own is a PROJECT under the employer above it,
not a new employer. Fold its bullets into that employer's "highlights".
Open a new entry only when you see a new DATE RANGE.`,
  },

  skills: {
    // Đo trên CV-07 thật: khối kỹ năng viết theo NHÓM
    //     Languages
    //     PHP 8.4, TypeScript, ...
    //     Frameworks
    //     Laravel 12, Vue 3, ...
    // Model trả về 8 "kỹ năng" chính là 8 NHÃN NHÓM, không có công nghệ nào.
    // Kết quả đó vô dụng cho đối chiếu JD — thứ JD hỏi là "Laravel", không phải
    // "Frameworks".
    vi: `
QUAN TRỌNG — khối kỹ năng thường viết theo nhóm:
    Ngôn ngữ
    PHP, TypeScript, Python
    Framework
    Laravel, Vue, React

"Ngôn ngữ", "Framework", "Cơ sở dữ liệu", "Công cụ"… là NHÃN NHÓM, KHÔNG phải
kỹ năng. Chỉ trích các mục nằm BÊN TRONG nhóm: PHP, TypeScript, Python,
Laravel, Vue, React — mỗi công nghệ là một phần tử riêng.
Bỏ số phiên bản: "Laravel 12" → "Laravel". Bỏ mô tả trong ngoặc.`,
    en: `
IMPORTANT — skill blocks are usually written by category:
    Languages
    PHP, TypeScript, Python
    Frameworks
    Laravel, Vue, React

"Languages", "Frameworks", "Databases", "Tools"… are CATEGORY LABELS, not
skills. Extract only the items INSIDE each category: PHP, TypeScript, Python,
Laravel, Vue, React — one element per technology.
Drop version numbers: "Laravel 12" → "Laravel". Drop parenthetical notes.`,
  },
}

function systemPrompt(kind: ParseableSection, lang: Language): string {
  const label = LABEL[kind][lang]
  const extra = EXTRA_RULES[kind]?.[lang] ?? ''
  if (lang === 'vi') {
    return `Bạn trích xuất mục "${label}" của một CV thành JSON. Trả về DUY NHẤT object JSON có khoá "items".

Quy tắc:
- CHỈ trích những mục thuộc "${label}". Bỏ qua nội dung khác nếu lọt vào.
- KHÔNG bịa. Thiếu field nào thì bỏ field đó, đừng đoán.
- KHÔNG suy ra con số không có trong text.
- Giữ nguyên tên riêng, tên công nghệ, tên trường, tên công ty ở dạng gốc.
- Mỗi mục con trong text là một phần tử của "items". Đừng gộp hai mục thành một.
- Nếu text không chứa mục nào thuộc loại này, trả {"items": []}.

Nội dung văn xuôi (highlights) viết bằng TIẾNG VIỆT tự nhiên, chuyên nghiệp.
Nếu gốc là tiếng Anh thì DỊCH nghĩa sang tiếng Việt, không dịch từng từ.${extra}`
  }
  return `You extract the "${label}" section of a CV into JSON. Return ONLY a JSON object with an "items" key.

Rules:
- Extract only entries belonging to "${label}". Ignore anything else that leaked in.
- Never invent. If a field is absent, omit it — do not guess.
- Never infer numbers that are not in the text.
- Preserve proper nouns, technology names, school and company names verbatim.
- Each distinct entry in the text is one element of "items". Do not merge two entries.
- If the text contains no entry of this kind, return {"items": []}.${extra}`
}

export interface ParseSectionInput {
  kind: ParseableSection
  /** Text của riêng mục đó, ĐÃ CHE PII */
  text: string
  outputLanguage: Language
}

type SectionOut<K extends ParseableSection> = z.infer<(typeof SCHEMAS)[K]>

/** Tạo task cho một loại mục. Cùng route `parse_cv_to_profile` trong config.yml. */
export function makeSectionTask<K extends ParseableSection>(
  kind: K,
): TaskDefinition<ParseSectionInput, SectionOut<K>> {
  return defineTask<ParseSectionInput, SectionOut<K>>({
    name: 'parse_cv_to_profile',
    schema: SCHEMAS[kind] as unknown as z.ZodType<SectionOut<K>, z.ZodTypeDef, unknown>,
    // Mục đơn lẻ nhỏ hơn cả CV rất nhiều
    budget: { total: 7_000, reserveForOutput: 2_200 },
    onSchemaFail: 'retry_then_fail',
    maxRetries: 2,
    temperature: 0,
    /*
     * 2200 chứ không phải 1800: một chỗ làm dài (CV-06 ~1900 ký tự, 5 gạch đầu
     * dòng) dịch sang tiếng Việt tốn 1.29× token, và JSON còn thêm khoá bao
     * quanh. Vượt hạn mức khi decode có grammar thì JSON đứt giữa câu →
     * SCHEMA_INVALID → retry cắt đúng chỗ đó → mất trắng cả khúc.
     *
     * Trần trên vẫn cần: `chunkSection` ở worker giữ mỗi lượt ~1800 ký tự.
     */
    maxTokens: 2_200,
    // 2200 token ở ~35 tok/s ≈ 63s, cộng prefill và lúc máy tải nặng → 150s
    timeoutMs: 150_000,
    buildSections: (input): PromptSection[] => [
      {
        key: 'system',
        role: 'system',
        content: systemPrompt(input.kind, input.outputLanguage),
        max: 700,
        droppable: false,
      },
      {
        key: 'section',
        role: 'user',
        content:
          input.outputLanguage === 'vi'
            ? `Mục "${LABEL[input.kind].vi}" của CV:\n\n${input.text}`
            : `CV "${LABEL[input.kind].en}" section:\n\n${input.text}`,
        max: 3_500,
        droppable: false,
      },
    ],
  })
}

/** Cache task theo loại — tránh dựng lại JSON Schema mỗi lần gọi */
const cache = new Map<ParseableSection, unknown>()
export function sectionTask<K extends ParseableSection>(
  kind: K,
): TaskDefinition<ParseSectionInput, SectionOut<K>> {
  let t = cache.get(kind)
  if (!t) {
    t = makeSectionTask(kind)
    cache.set(kind, t)
  }
  return t as TaskDefinition<ParseSectionInput, SectionOut<K>>
}
