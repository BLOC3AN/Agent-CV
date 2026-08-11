import { describe, expect, it } from 'vitest'
import { errorMessageKey, jobErrorCode } from '../src/lib/error-messages'
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
