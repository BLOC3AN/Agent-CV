import { describe, expect, it } from 'vitest'
import { relativeTime } from '../src/lib/format.js'

const now = new Date('2026-08-09T12:00:00Z')

describe('relativeTime', () => {
  it('dưới một phút vẫn nói "1 phút trước", không nói "0 phút"', () => {
    expect(relativeTime('2026-08-09T11:59:50Z', now)).toBe('1 phút trước')
  })

  it('tính theo phút trong vòng một giờ', () => {
    expect(relativeTime('2026-08-09T11:15:00Z', now)).toBe('45 phút trước')
  })

  it('tính theo giờ trong vòng một ngày', () => {
    expect(relativeTime('2026-08-09T04:00:00Z', now)).toBe('8 giờ trước')
  })

  it('tính theo ngày khi quá 24 giờ', () => {
    expect(relativeTime('2026-08-06T12:00:00Z', now)).toBe('3 ngày trước')
  })

  it('chuỗi không hợp lệ trả về dấu gạch, không trả "NaN phút trước"', () => {
    expect(relativeTime('không phải ngày tháng', now)).toBe('—')
  })
})
