import { describe, it, expect } from 'vitest'
import { destinationAfterReview, intentQuery, parseIntent } from '@/lib/intent'

/**
 * TC-01-10/11 — bốn lối vào, MỘT hồ sơ. UC-01 bước 5, BR-01.1.
 *
 * Ý định chỉ đổi ĐÍCH ĐẾN sau khi rà soát, không đổi dữ liệu. Vi phạm điều đó
 * là sản phẩm tách thành bốn phần dùng chung một logo.
 */

describe('parseIntent', () => {
  it('nhận ba ý định hợp lệ', () => {
    expect(parseIntent('improve')).toBe('improve')
    expect(parseIntent('diagnose')).toBe('diagnose')
    expect(parseIntent('job')).toBe('job')
  })

  it('giá trị lạ hoặc thiếu → null, KHÔNG đoán bừa', () => {
    // Đoán bừa thì người dùng bị dẫn tới một màn hình họ không chọn
    expect(parseIntent('../../etc/passwd')).toBeNull()
    expect(parseIntent('')).toBeNull()
    expect(parseIntent(null)).toBeNull()
    expect(parseIntent(undefined)).toBeNull()
  })
})

describe('destinationAfterReview', () => {
  it('TC-01-11 "không biết dở ở đâu" → màn CHẨN ĐOÁN, không phải trình soạn', () => {
    // Đây là cả lý do lối vào đó tồn tại
    expect(destinationAfterReview('diagnose', 'cv1')).toBe('/diagnose/cv1')
  })

  it('"có việc muốn ứng tuyển" → thẳng màn đối chiếu', () => {
    // Họ đã nói rõ mục đích; bắt tự tìm Jobs → Analyze là bắt nói hai lần
    expect(destinationAfterReview('job', 'cv1')).toBe('/analyze/cv1')
  })

  it('không có ý định → trình soạn như cũ', () => {
    expect(destinationAfterReview(null, 'cv1')).toBe('/builder/cv1')
    expect(destinationAfterReview('improve', 'cv1')).toBe('/builder/cv1')
  })

  it('mọi đích đều là đường dẫn nội bộ', () => {
    for (const i of ['improve', 'diagnose', 'job', null] as const) {
      expect(destinationAfterReview(i, 'cv1')).toMatch(/^\/[a-z]/)
    }
  })

  it('TC-01-12 mọi lối vào dùng CÙNG một cvId — không nhân bản hồ sơ', () => {
    const dests = (['improve', 'diagnose', 'job'] as const).map((i) =>
      destinationAfterReview(i, 'cv-chung'),
    )
    for (const d of dests) expect(d).toContain('cv-chung')
  })
})

describe('intentQuery', () => {
  it('mang ý định sang bước sau', () => {
    expect(intentQuery('diagnose')).toBe('?intent=diagnose')
  })

  it('không có ý định thì KHÔNG thêm query rỗng', () => {
    expect(intentQuery(null)).toBe('')
  })
})
