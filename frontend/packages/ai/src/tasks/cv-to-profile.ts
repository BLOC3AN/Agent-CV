import { ParsedProfileSchema, type ParsedProfile, type Language } from '@hr/schema'
import { defineTask } from '../gateway.js'
import type { PromptSection } from '../types.js'

/**
 * Task `parse_cv_to_profile` — TDD §8.1 bước [4], UC-21.
 *
 * Ngân sách (TDD §6.2): system 1200 · raw 3500 · output 2800 → 7500
 *
 * `outputLanguage` cho phép dùng lại task này để DỊCH: đọc CV tiếng Anh, xuất
 * Profile tiếng Việt. Dùng khi dựng fixture đánh giá (eval/translate-cv.ts).
 *
 * ⚠️ Text đầu vào PHẢI đã qua redactPII() — xem eval/lib/redact.ts và
 *    gateway.guardPII() sẽ chặn nếu còn sót.
 */

export interface CvToProfileInput {
  /** Text CV ĐÃ CHE PII */
  text: string
  /** Ngôn ngữ của Profile xuất ra — không nhất thiết trùng ngôn ngữ CV gốc */
  outputLanguage: Language
}

const RULES_VI = `Bạn là công cụ chuyển CV thành dữ liệu có cấu trúc. Trả về DUY NHẤT một object JSON theo schema.

Quy tắc bắt buộc:
- KHÔNG bịa thông tin. Chỉ dùng những gì CV nêu. Thiếu thì để mảng rỗng hoặc bỏ field.
- KHÔNG suy ra con số không có trong CV.
- Giữ nguyên số liệu, tên công nghệ, tên trường, tên công ty như CV viết.
- Các placeholder dạng <NAME>, <EMAIL>, <PHONE>, <LOCATION>, <DOB> là PII đã bị
  che. BỎ QUA chúng — schema không có chỗ cho họ tên, email, SĐT, địa chỉ.
- "highlights" là các gạch đầu dòng mô tả việc đã làm, giữ nguyên ý.
- "language" đặt là "vi".
- schemaVersion luôn là 1.

Toàn bộ nội dung văn xuôi (highlights, summary, headline, tên mục) phải viết
bằng TIẾNG VIỆT tự nhiên, đúng ngữ pháp, giọng chuyên nghiệp. Nếu CV gốc là
tiếng Anh thì DỊCH sang tiếng Việt — dịch nghĩa, không dịch từng từ. Giữ nguyên
tên riêng, tên công nghệ, tên công ty, tên trường ở dạng gốc.`

const RULES_EN = `You convert a CV into structured data. Return ONLY a JSON object matching the schema.

Hard rules:
- Never invent information. Use only what the CV states. If missing, use an empty array or omit the field.
- Never infer numbers that are not in the CV.
- Preserve metrics, technology names, school names, and company names exactly as written.
- Placeholders like <NAME>, <EMAIL>, <PHONE>, <LOCATION>, <DOB> are redacted PII.
  Ignore them — the schema has no fields for name, email, phone, or address.
- "highlights" are the bullet points describing what was done; preserve meaning.
- Set "language" to "en".
- schemaVersion is always 1.

All prose (highlights, summary, headline) must be natural, professional English.`

export const cvToProfileTask = defineTask<CvToProfileInput, ParsedProfile>({
  name: 'parse_cv_to_profile',
  schema: ParsedProfileSchema,
  budget: { total: 12_000, reserveForOutput: 3_500 },
  onSchemaFail: 'retry_then_escalate',
  maxRetries: 2,
  temperature: 0,
  maxTokens: 3_500,
  // ~3500 token output ở 35 tok/s ≈ 100s, cộng prefill → 180s cho an toàn.
  // Timeout mặc định 60s trong config.yml quá ngắn cho task sinh dài (TDD §14.1).
  timeoutMs: 180_000,

  buildSections(input): PromptSection[] {
    // Thứ tự cố định để tận dụng prefix cache (TDD §6.6)
    return [
      {
        key: 'system',
        role: 'system',
        content: input.outputLanguage === 'vi' ? RULES_VI : RULES_EN,
        max: 1_200,
        droppable: false,
      },
      {
        key: 'cv',
        role: 'user',
        content:
          input.outputLanguage === 'vi'
            ? `Nội dung CV:\n\n${input.text}`
            : `CV content:\n\n${input.text}`,
        max: 6_000,
        droppable: false,
        // Không có compactor: cắt CV giữa chừng sẽ mất nguyên mục kinh nghiệm.
        // Vượt ngân sách → BUDGET_EXCEEDED → tầng trên chia nhỏ (TDD §6.4 bước 5).
      },
    ]
  },
})
