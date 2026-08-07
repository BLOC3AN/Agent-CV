/**
 * Ý định người dùng chọn ở Home, mang theo suốt luồng — UC-01 bước 5.
 *
 * ── Vì sao cần ──
 * Không mang theo thì người bấm "Tôi không biết CV mình dở ở đâu" tải file lên
 * xong bị quăng thẳng vào trình soạn, và câu hỏi thật của họ — *"CV tôi dở ở
 * chỗ nào?"* — không được trả lời ở bất kỳ đâu. Cũng vậy với người vào bằng
 * "Tôi có việc muốn ứng tuyển": họ đã nói rõ mục đích rồi, bắt họ tự tìm
 * *Jobs → Analyze* là bắt nói hai lần.
 *
 * Bốn lối vào vẫn dùng CHUNG một `Profile` (BR-01.1) — ý định chỉ đổi ĐÍCH ĐẾN
 * sau khi rà soát xong, không đổi dữ liệu.
 */

export const INTENTS = ['improve', 'diagnose', 'job'] as const
export type Intent = (typeof INTENTS)[number]

export function parseIntent(v: string | null | undefined): Intent | null {
  return INTENTS.includes(v as Intent) ? (v as Intent) : null
}

/** Chuỗi query mang ý định sang bước sau; rỗng khi không có ý định nào. */
export function intentQuery(intent: Intent | null): string {
  return intent ? `?intent=${intent}` : ''
}

/** Rà soát xong thì đi đâu — đích thay đổi theo thứ người dùng đã nói ở Home. */
export function destinationAfterReview(intent: Intent | null, cvId: string): string {
  if (intent === 'diagnose') return `/diagnose/${cvId}`
  if (intent === 'job') return `/analyze/${cvId}`
  return `/builder/${cvId}`
}
