/**
 * Mã lỗi của máy chủ → khoá message của giao diện.
 *
 * Máy chủ (Go) dựng câu chữ bằng tiếng Việt cố định — ví dụ worker trả
 * `NO_CV_SECTIONS: Không nhận ra mục CV như học vấn, kinh nghiệm hoặc kỹ năng`.
 * Giao diện không dịch được chữ tự do đó, nhưng dịch được cái MÃ đứng trước:
 * mã là hợp đồng ổn định giữa hai phía, còn câu chữ thì server đổi lúc nào
 * cũng được.
 *
 * Bảng này ở tầng UI chứ không nằm trong `lib/api.ts` như trước: `api.ts` là
 * tầng vận chuyển, không có `t` trong tay, nên đặt bảng dịch ở đó là lý do
 * mọi thông báo lỗi kẹt lại tiếng Việt.
 *
 * Mã lạ trả `undefined` — chỗ gọi lùi về nguyên văn của máy chủ. Thà hiện một
 * câu tiếng Việt còn hơn nuốt lỗi hoặc hiện một chuỗi rỗng.
 */

import type { MessageKey } from './i18n'
import { ApiError } from './api'

const CODE_TO_KEY: Record<string, MessageKey> = {
  V2_NOT_BACKFILLED: 'errorV2NotBackfilled',
  SCHEMA_V2_INVALID: 'errorSchemaV2Invalid',
  NO_CV_SECTIONS: 'errorNoCVSections',
  FILE_MISSING: 'errorFileMissing',
  PDF_EXTRACT_FAILED: 'errorPDFExtractFailed',
  PROFILE_CREATE_FAILED: 'errorProfileCreateFailed',
  GO_UNKNOWN_KIND: 'errorUnknownJobKind',
  // Mã do chính client sinh ra — cùng cơ chế, để lỗi mạng cũng dịch được.
  NETWORK_UNREACHABLE: 'errorNetworkUnreachable',
  SERVER_ERROR: 'errorServer',
  STREAM_OPEN_FAILED: 'errorStreamOpen',
  STREAM_CLOSED_EARLY: 'errorStreamClosed',
  SEND_FAILED: 'sendFailed',
  AI_PATCH_INVALID_CV: 'errorAIPatchInvalidCV',
  AI_PATCH_INVALID_LAYOUT: 'errorAIPatchInvalidLayout',
  AI_PATCH_LAYOUT_REPLACE: 'errorAIPatchLayoutReplace',
  PDF_DOWNLOAD_FAILED: 'downloadFailed',
}

export function errorMessageKey(code: string | undefined): MessageKey | undefined {
  return code ? CODE_TO_KEY[code] : undefined
}

/**
 * Tách mã khỏi thông báo lỗi của job.
 *
 * Worker trả chuỗi thô dạng `MÃ: mô tả`, không phải JSON có trường `code`.
 * Chỉ nhận dạng CHỮ HOA và gạch dưới để một câu tiếng Việt có dấu hai chấm
 * ("Không tải được CV: hết thời gian chờ") không bị hiểu nhầm thành mã.
 */
export function jobErrorCode(message: string | undefined): string | undefined {
  const match = /^([A-Z][A-Z0-9_]*):/.exec(message?.trim() ?? '')
  return match?.[1]
}

/**
 * Lỗi bất kỳ → câu chữ hiển thị được, đã dịch khi biết mã.
 *
 * Thứ tự ưu tiên: mã đã biết → nguyên văn của máy chủ → câu lùi của chỗ gọi.
 * Giữ nguyên văn ở giữa là cố ý: một mã mới từ backend vẫn hiện ra thứ gì đó
 * đọc được thay vì biến mất, và chính nó là dấu hiệu cần bổ sung vào bảng.
 */
export function errorText(
  error: unknown,
  t: (key: MessageKey) => string,
  fallback: string,
): string {
  if (error instanceof ApiError) {
    const key = errorMessageKey(error.code)
    return key ? t(key) : (error.message || fallback)
  }
  if (error instanceof Error) {
    const key = errorMessageKey(jobErrorCode(error.message))
    return key ? t(key) : (error.message || fallback)
  }
  return fallback
}

/** Thông báo lỗi thô của job (`MÃ: mô tả`) → câu chữ đã dịch. */
export function jobErrorText(
  message: string | undefined,
  t: (key: MessageKey) => string,
): string | undefined {
  if (!message?.trim()) return undefined
  const key = errorMessageKey(jobErrorCode(message))
  return key ? t(key) : message
}

/**
 * Nhãn tiến trình máy chủ bắn qua SSE (`server.go`, `sendStep(...)`).
 *
 * Máy chủ nay gửi MÃ (`THINKING`, …) nên bảng này tra theo mã như mọi thứ khác.
 * Bốn câu tiếng Việt của bản backend cũ vẫn giữ trong bảng: nếu frontend lên
 * trước backend, người dùng vẫn thấy nhãn đúng thay vì một chuỗi lạ.
 */
const STEP_TO_KEY: Record<string, MessageKey> = {
  THINKING: 'stepThinking',
  UNDERSTANDING: 'stepUnderstanding',
  REVIEWING_PROFILE: 'stepReviewingProfile',
  CHECKING_PROPOSAL: 'stepCheckingProposal',
  // Câu chữ của bản backend cũ, giữ để một máy chủ chưa cập nhật vẫn hiện đúng.
  'Đang suy nghĩ': 'stepThinking',
  'Đang hiểu yêu cầu của bạn': 'stepUnderstanding',
  'Đang xem lại hồ sơ để trả lời': 'stepReviewingProfile',
  'Đang kiểm tra đề xuất': 'stepCheckingProposal',
}

export function stepText(
  label: string | undefined,
  t: (key: MessageKey) => string,
): string | undefined {
  if (!label) return undefined
  const key = STEP_TO_KEY[label.trim()]
  return key ? t(key) : label
}
