import { JDRequirementsSchema, type JDRequirements, type Language } from '@hr/schema'
import { defineTask } from '../gateway.js'
import { makeLineTrimmer } from '../budget.js'
import type { PromptSection } from '../types.js'

/**
 * Task `parse_jd` — TDD §8.2, UC-41.
 *
 * Ngân sách (TDD §6.2, đã nhân 1.29 cho tiếng Việt):
 *   system 600 · jd raw 1500 · output 900 → tổng 3000
 *
 * Routing (config.yml): local.reasoner → fallback local.generalist
 *   khi bật cloud: anthropic.cheap
 */

export interface ParseJDInput {
  rawText: string
  language: Language
}

const SYSTEM_VI = `Bạn là công cụ trích xuất yêu cầu tuyển dụng. Nhiệm vụ: đọc mô tả công việc và trả về DUY NHẤT một object JSON.

Quy tắc:
- Chỉ trả JSON, không giải thích, không markdown fence.
- Giữ nguyên thuật ngữ mà JD dùng (nếu JD ghi "RESTful API" thì đừng rút gọn thành "API").
- "hardSkills": công nghệ/kỹ năng kỹ thuật bắt buộc.
- "niceToHave": yêu cầu ưu tiên nhưng không bắt buộc.
- "atsKeywords": từ khoá nhà tuyển dụng có thể dùng để lọc hồ sơ tự động.
- Không suy diễn thông tin JD không nêu. Không chắc thì để mảng rỗng hoặc null.
- "seniority" chọn một trong: intern, fresher, junior, mid, senior, lead, unknown.
- "roleFamily" chọn một trong: backend_developer, frontend_developer, fullstack_developer, mobile_developer, data_analyst, data_engineer, qa_tester, devops, business_analyst, product_manager, ui_ux_designer, other.

Cấu trúc JSON:
{"title":"","language":"vi","roleFamily":"","seniority":"","domain":null,"yearsRequired":null,"hardSkills":[],"softSkills":[],"responsibilities":[],"atsKeywords":[],"niceToHave":[],"education":null}`

const SYSTEM_EN = `You extract structured hiring requirements. Read the job description and return ONLY a JSON object.

Rules:
- Return JSON only. No prose, no markdown fence.
- Preserve the JD's own terminology (if it says "RESTful API", do not shorten to "API").
- "hardSkills": required technical skills/technologies.
- "niceToHave": preferred but not required.
- "atsKeywords": terms a recruiter's automated filter may screen on.
- Never infer facts the JD does not state. When unsure, use an empty array or null.
- "seniority" must be one of: intern, fresher, junior, mid, senior, lead, unknown.
- "roleFamily" must be one of: backend_developer, frontend_developer, fullstack_developer, mobile_developer, data_analyst, data_engineer, qa_tester, devops, business_analyst, product_manager, ui_ux_designer, other.

JSON shape:
{"title":"","language":"en","roleFamily":"","seniority":"","domain":null,"yearsRequired":null,"hardSkills":[],"softSkills":[],"responsibilities":[],"atsKeywords":[],"niceToHave":[],"education":null}`

/**
 * BR-41.1 — JD dài thì cắt phần phúc lợi/giới thiệu công ty, GIỮ phần yêu cầu.
 * Cắt có ưu tiên, không cắt cụt từ đầu xuống.
 */
const DEPRIORITIZE = [
  /quyền lợi|phúc lợi|đãi ngộ|chế độ|benefits?|perks?|compensation/i,
  /về công ty|giới thiệu công ty|about us|about the company|our culture/i,
  /địa điểm làm việc|thời gian làm việc|working hours?|location/i,
  /cách thức ứng tuyển|how to apply|liên hệ|contact/i,
]

export function trimJD(text: string, targetTokens: number): string {
  const approxChars = targetTokens * 3
  if (text.length <= approxChars) return text

  const blocks = text.split(/\n{2,}/)
  const keep: string[] = []
  const maybe: string[] = []
  for (const b of blocks) {
    if (DEPRIORITIZE.some((re) => re.test(b))) maybe.push(b)
    else keep.push(b)
  }

  let out = keep.join('\n\n')
  if (out.length > approxChars) {
    // Vẫn dài: cắt theo block từ cuối, giữ phần đầu (thường là yêu cầu chính)
    const kept: string[] = []
    let used = 0
    for (const b of keep) {
      if (used + b.length > approxChars) break
      kept.push(b)
      used += b.length + 2
    }
    out = kept.join('\n\n')
  } else {
    for (const b of maybe) {
      if (out.length + b.length > approxChars) break
      out += '\n\n' + b
    }
  }
  return out
}

export const parseJDTask = defineTask<ParseJDInput, JDRequirements>({
  name: 'parse_jd',
  schema: JDRequirementsSchema,
  budget: { total: 3_000, reserveForOutput: 900 },
  onSchemaFail: 'retry_then_escalate',
  maxRetries: 2,
  temperature: 0,
  maxTokens: 900,

  buildSections(input): PromptSection[] {
    // Thứ tự CỐ ĐỊNH để tận dụng prefix cache của llama.cpp (TDD §6.6):
    // [system ổn định] → [nội dung thay đổi]
    return [
      {
        key: 'system',
        role: 'system',
        content: input.language === 'vi' ? SYSTEM_VI : SYSTEM_EN,
        max: 600,
        droppable: false,
      },
      {
        key: 'jd',
        role: 'user',
        content:
          input.language === 'vi'
            ? `Mô tả công việc:\n\n${input.rawText}`
            : `Job description:\n\n${input.rawText}`,
        max: 1_500,
        droppable: false,
        compactor: (content, target) => {
          const prefix = content.slice(0, content.indexOf('\n\n') + 2)
          const body = content.slice(prefix.length)
          return prefix + trimJD(body, target - 20)
        },
      },
    ]
  },
})

export { makeLineTrimmer }
