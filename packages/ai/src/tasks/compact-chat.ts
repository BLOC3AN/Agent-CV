import { z } from 'zod'
import type { Language } from '@hr/schema'
import { defineTask } from '../gateway.js'
import type { PromptSection } from '../types.js'

/**
 * `compact_chat` — nén lịch sử hội thoại khi vượt ngân sách. TDD §6.4, BR-51.1.
 *
 * Ngân sách làm việc là 12.000 token. Một phiên chat dài sẽ đẩy hồ sơ và tri
 * thức HR ra khỏi prompt trước khi đẩy chính lịch sử — mà hồ sơ mới là thứ
 * trợ lý cần nhất. Nén phần cũ giữ lại được ngữ cảnh với chi phí token nhỏ.
 *
 * KHÔNG nén thành "tóm tắt hay": nén thành DANH SÁCH SỰ KIỆN. Trợ lý cần nhớ
 * "người dùng nói dự án có 4 người", không cần nhớ họ đã nói câu đó thế nào.
 */

export const ChatSummarySchema = z.object({
  /** Sự kiện đã xảy ra trong phiên — mỗi dòng một sự kiện */
  facts: z.array(z.string()).max(20).default([]),
  /** Thay đổi đã áp dụng vào hồ sơ */
  applied: z.array(z.string()).max(10).default([]),
  /** Điều người dùng đã từ chối — đừng đề xuất lại */
  rejected: z.array(z.string()).max(10).default([]),
})

export type ChatSummary = z.infer<typeof ChatSummarySchema>

export interface CompactChatInput {
  /** Tóm tắt của lần nén trước, nếu có — nén chồng lên nhau */
  previousSummary: ChatSummary | null
  messages: { role: 'user' | 'assistant'; content: string }[]
  language: Language
}

const SYSTEM_VI = `Bạn nén lịch sử hội thoại về CV thành dữ liệu ngắn gọn. Trả về DUY NHẤT một object JSON.

"facts"    — thông tin NGƯỜI DÙNG đã cung cấp. Mỗi dòng một sự kiện, giữ nguyên
             con số và tên riêng. Ví dụ: "Dự án Shop có 4 thành viên, bạn làm backend".
"applied"  — thay đổi đã ÁP DỤNG vào hồ sơ.
"rejected" — đề xuất người dùng đã TỪ CHỐI. Quan trọng: đừng để trợ lý đề xuất lại.

Quy tắc:
- CHỈ ghi thứ đã nói ra. Không suy diễn, không tóm tắt cảm tính.
- GIỮ NGUYÊN mọi con số. Con số là thứ không được phép sai lệch.
- Bỏ hết lời chào, cảm ơn, câu xã giao.
- Mỗi dòng dưới 25 từ.`

const SYSTEM_EN = `Compress a CV-editing conversation into compact data. Return ONLY a JSON object.

"facts"    — information THE USER supplied. One fact per line, numbers and proper
             nouns preserved verbatim.
"applied"  — changes already applied to the profile.
"rejected" — proposals the user declined. Important: stops the assistant re-proposing them.

Rules:
- Record only what was actually said. No inference, no impressions.
- PRESERVE every number exactly.
- Drop greetings and pleasantries.
- Under 25 words per line.`

export const compactChatTask = defineTask<CompactChatInput, ChatSummary>({
  name: 'compact_chat',
  schema: ChatSummarySchema,
  budget: { total: 8_000, reserveForOutput: 1_200 },
  onSchemaFail: 'retry_then_fail',
  maxRetries: 1,
  temperature: 0,
  maxTokens: 1_200,
  timeoutMs: 90_000,

  buildSections: (input): PromptSection[] => [
    {
      key: 'system',
      role: 'system',
      content: input.language === 'vi' ? SYSTEM_VI : SYSTEM_EN,
      max: 600,
      droppable: false,
    },
    {
      key: 'previous',
      role: 'user',
      content: input.previousSummary
        ? `Tóm tắt trước đó (gộp vào kết quả mới):\n${JSON.stringify(input.previousSummary)}`
        : '',
      max: 1_500,
      droppable: false,
    },
    {
      key: 'messages',
      role: 'user',
      content:
        'Hội thoại cần nén:\n' +
        input.messages
          .map((m) => `${m.role === 'user' ? 'Người dùng' : 'Trợ lý'}: ${m.content}`)
          .join('\n'),
      max: 5_000,
      droppable: false,
      // Quá dài thì cắt phần ĐẦU, giữ phần cuối: lượt gần đây liên quan hơn
      compactor: (content, target) => {
        const chars = target * 3
        return content.length <= chars ? content : `…\n${content.slice(-chars)}`
      },
    },
  ],
})
