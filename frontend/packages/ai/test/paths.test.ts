import { describe, it, expect } from 'vitest'
import { expandCompactPath, sectionLabel, humanizePointers } from '../src/paths.js'

/**
 * TDD §8.3.6 — `plan_agent_step` đọc CompactProfile nên trả con trỏ rút gọn.
 * Ba hậu quả đều IM LẶNG, và cái thứ ba lọt thẳng ra màn hình người dùng.
 */

describe('expandCompactPath', () => {
  it('dịch key rút gọn về tên thật', () => {
    expect(expandCompactPath('/act')).toBe('/activities')
    expect(expandCompactPath('/exp/0/h/0')).toBe('/work/0/highlights/0')
    expect(expandCompactPath('/proj/1/n')).toBe('/projects/1/name')
  })

  it('con trỏ vốn đã đúng thì giữ nguyên — gọi lên là vô hại', () => {
    expect(expandCompactPath('/work/0/highlights/0')).toBe('/work/0/highlights/0')
  expect(expandCompactPath('/basics/introduce')).toBe('/basics/introduce')
  })

  it('null đi qua nguyên vẹn', () => {
    expect(expandCompactPath(null)).toBeNull()
  })
})

describe('sectionLabel', () => {
  it('nhận cả hai không gian tên', () => {
    expect(sectionLabel('/act')).toBe('Hoạt động')
    expect(sectionLabel('/activities/0')).toBe('Hoạt động')
    expect(sectionLabel('/work/0/highlights/1')).toBe('Kinh nghiệm')
  })

  it('không nhận ra thì trả null, không đoán bừa', () => {
    expect(sectionLabel('/khongbiet')).toBeNull()
    expect(sectionLabel(null)).toBeNull()
  })
})

describe('humanizePointers — chốt chặn cuối trước màn hình', () => {
  it('thay con trỏ bằng tên mục tiếng Việt', () => {
    // Câu này model đã viết ra màn hình thật
    const out = humanizePointers('Để xác định đúng hướng đi cho vị trí /act, cần biết bạn muốn gì.')
    expect(out).toBe('Để xác định đúng hướng đi cho vị trí Hoạt động, cần biết bạn muốn gì.')
  })

  it('con trỏ sâu cũng thành tên mục', () => {
    expect(humanizePointers('Sửa ở /work/0/highlights/1 nhé')).toBe('Sửa ở Kinh nghiệm nhé')
  })

  it('không nhận ra thì BỎ HẲN, không để lại rác', () => {
    const out = humanizePointers('Mục /khongbiet đang trống')
    expect(out).not.toContain('/khongbiet')
    expect(out).toBe('Mục đang trống')
  })

  it('dọn ngoặc rỗng còn lại sau khi bỏ con trỏ', () => {
    expect(humanizePointers("mục 'Dự án' (/khongbiet) trống")).not.toContain('()')
  })

  it('không đụng vào câu không có con trỏ', () => {
    const t = 'Mục Kinh nghiệm của bạn chưa có số liệu nào.'
    expect(humanizePointers(t)).toBe(t)
  })
})
