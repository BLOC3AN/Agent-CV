import { describe, it, expect } from 'vitest'
import { dedupeMatches } from '@/lib/home-state'

/**
 * Trên máy thật, Home hiện HAI dòng "Junior Full-stack Developer 44%" giống
 * hệt nhau — cùng tiêu đề, cùng điểm, không mốc thời gian. Đó là hai lần phân
 * tích cùng một JD, nhưng người dùng không có cách nào biết điều đó.
 *
 * Giữ lần MỚI NHẤT chứ không phải điểm cao nhất: người dùng muốn biết hồ sơ
 * hiện tại khớp tới đâu, không phải kỷ lục cũ.
 *
 * `dedupeMatches` sống ở `lib/home-state.ts`, không ở `app/page.tsx`: Next.js
 * chặn build/typecheck nếu page.tsx export thêm một hàm thuần ngoài danh sách
 * export đã biết trước (default, metadata, dynamic, ...) — xác nhận bằng lỗi
 * `tsc` thật khi thử export trực tiếp từ page.tsx.
 */

describe('dedupeMatches', () => {
  it('gộp các lần phân tích cùng một JD, giữ bản đầu tiên trong danh sách', () => {
    const rows = [
      { jdId: 'jd-1', overall: 44 },
      { jdId: 'jd-1', overall: 38 },
      { jdId: 'jd-2', overall: 72 },
    ]
    expect(dedupeMatches(rows)).toEqual([
      { jdId: 'jd-1', overall: 44 },
      { jdId: 'jd-2', overall: 72 },
    ])
  })

  it('jdId null thì KHÔNG gộp — không biết chúng có cùng JD hay không', () => {
    const rows = [
      { jdId: null, overall: 44 },
      { jdId: null, overall: 51 },
    ]
    expect(dedupeMatches(rows)).toHaveLength(2)
  })

  it('danh sách rỗng trả về rỗng', () => {
    expect(dedupeMatches([])).toEqual([])
  })

  it('không có trùng thì giữ nguyên thứ tự', () => {
    const rows = [{ jdId: 'a', overall: 1 }, { jdId: 'b', overall: 2 }]
    expect(dedupeMatches(rows)).toEqual(rows)
  })
})
