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

function systemPrompt(kind: ParseableSection, lang: Language): string {
  const label = LABEL[kind][lang]
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
Nếu gốc là tiếng Anh thì DỊCH nghĩa sang tiếng Việt, không dịch từng từ.`
  }
  return `You extract the "${label}" section of a CV into JSON. Return ONLY a JSON object with an "items" key.

Rules:
- Extract only entries belonging to "${label}". Ignore anything else that leaked in.
- Never invent. If a field is absent, omit it — do not guess.
- Never infer numbers that are not in the text.
- Preserve proper nouns, technology names, school and company names verbatim.
- Each distinct entry in the text is one element of "items". Do not merge two entries.
- If the text contains no entry of this kind, return {"items": []}.`
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
    budget: { total: 6_000, reserveForOutput: 1_800 },
    onSchemaFail: 'retry_then_fail',
    maxRetries: 2,
    temperature: 0,
    maxTokens: 1_800,
    timeoutMs: 90_000,
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
