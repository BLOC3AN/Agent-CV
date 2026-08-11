import { describe, expect, it } from 'vitest'
import { errorMessageKey, jobErrorCode, stepText } from '../src/lib/error-messages'
import { en } from '../src/lib/i18n/messages.en'
import type { MessageKey } from '../src/lib/i18n'
import { ApiError } from '../src/lib/api'

describe('mã lỗi của máy chủ', () => {
  /*
   * Câu chữ của máy chủ là tiếng Việt cố định (worker Go dựng nó), nên giao
   * diện KHÔNG dịch được nó. Thứ dịch được là MÃ — hợp đồng ổn định giữa hai
   * phía. Đây là lý do `ApiError` phải giữ lại `code` thay vì nuốt mất.
   */
  it('lấy khoá message từ mã lỗi đã biết', () => {
    expect(errorMessageKey('V2_NOT_BACKFILLED')).toBe('errorV2NotBackfilled')
    expect(errorMessageKey('NO_CV_SECTIONS')).toBe('errorNoCVSections')
  })

  it('trả undefined cho mã lạ, để chỗ gọi lùi về text của máy chủ', () => {
    expect(errorMessageKey('SOMETHING_NEW_FROM_BACKEND')).toBeUndefined()
    expect(errorMessageKey(undefined)).toBeUndefined()
  })

  /* Worker Go trả chuỗi dạng `MÃ: mô tả`, không phải JSON có trường `code`. */
  it('tách được mã từ thông báo lỗi của job', () => {
    expect(jobErrorCode('NO_CV_SECTIONS: Không nhận ra mục CV như học vấn, kinh nghiệm hoặc kỹ năng')).toBe('NO_CV_SECTIONS')
    expect(jobErrorCode('FILE_MISSING: open /tmp/x: no such file')).toBe('FILE_MISSING')
  })

  it('không nhận nhầm câu tiếng Việt thường thành mã', () => {
    expect(jobErrorCode('Không tải được CV: hết thời gian chờ')).toBeUndefined()
    expect(jobErrorCode('')).toBeUndefined()
    expect(jobErrorCode(undefined)).toBeUndefined()
  })

  it('ApiError giữ lại mã để giao diện dịch được', () => {
    const error = new ApiError(422, 'Máy chủ trả về lỗi', 'NO_CV_SECTIONS')

    expect(error.code).toBe('NO_CV_SECTIONS')
    expect(error.status).toBe(422)
  })
})

describe('nhãn tiến trình do máy chủ bắn qua SSE', () => {
  /*
   * Khác `NO_CV_SECTIONS`, các nhãn này KHÔNG kèm mã — máy chủ gửi thẳng câu
   * tiếng Việt (`server.go`, `sendStep("Đang suy nghĩ")`). Không sửa được ở
   * backend lúc này, nên tra theo đúng câu chữ; câu lạ thì giữ nguyên.
   */
  it('dịch các mã máy chủ gửi', () => {
    const t = (key: MessageKey) => en[key]

    expect(stepText('THINKING', t)).toBe(en.stepThinking)
    expect(stepText('UNDERSTANDING', t)).toBe(en.stepUnderstanding)
    expect(stepText('REVIEWING_PROFILE', t)).toBe(en.stepReviewingProfile)
    expect(stepText('CHECKING_PROPOSAL', t)).toBe(en.stepCheckingProposal)
  })

  /* Frontend có thể lên trước backend — nhãn của bản cũ vẫn phải hiện đúng. */
  it('vẫn hiểu câu chữ của bản backend cũ', () => {
    const t = (key: MessageKey) => en[key]

    expect(stepText('Đang suy nghĩ', t)).toBe(en.stepThinking)
  })

  it('nhãn lạ thì giữ nguyên thay vì nuốt mất', () => {
    const t = (key: MessageKey) => en[key]

    expect(stepText('Một bước mới nào đó', t)).toBe('Một bước mới nào đó')
    expect(stepText(undefined, t)).toBeUndefined()
  })
})

describe('lỗi của trợ lý AI', () => {
  /*
   * Bản trước, khi mô hình trả JSON hỏng (thường vì bị cắt do chạm giới hạn
   * token), backend đổ NGUYÊN VĂN khối JSON đó vào khung chat. Giờ nó gửi mã
   * và giao diện dịch thành câu người đọc hiểu được.
   */
  it('dịch mã lỗi của mô hình', () => {
    const t = (key: MessageKey) => en[key]

    expect(errorMessageKey('MODEL_OUTPUT_UNPARSABLE')).toBe('errorModelOutputUnparsable')
    expect(errorMessageKey('MODEL_UNAVAILABLE')).toBe('errorModelUnavailable')
    expect(t(errorMessageKey('MODEL_OUTPUT_UNPARSABLE')!)).toContain('cut off')
  })
})
