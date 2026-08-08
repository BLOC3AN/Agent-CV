import { describe, it, expect } from 'vitest'
import { existsSync, statSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Font từng được KHAI mà không được NẠP — `globals.css` và
 * `packages/templates/src/styles.css` cùng ghi 'Be Vietnam Pro' trong khi repo
 * không có file font nào. Hệ quả không lộ trên màn hình dev (máy nào cũng có
 * font thay thế trông tạm ổn) mà lộ ở file PDF người dùng nộp đi.
 *
 * Test này giữ cho khai báo và file luôn đi cùng nhau.
 */

const FONTS = [
  'BeVietnamPro-Regular.woff2',
  'BeVietnamPro-SemiBold.woff2',
]

describe('font Be Vietnam Pro', () => {
  it.each(FONTS)('%s có mặt và không rỗng', (name) => {
    const p = resolve(__dirname, '../app/fonts', name)
    expect(existsSync(p)).toBe(true)
    expect(statSync(p).size).toBeGreaterThan(1_000)
  })

  it('lib/fonts.ts khai biến CSS --font-be-vietnam', () => {
    const src = readFileSync(resolve(__dirname, '../lib/fonts.ts'), 'utf8')
    expect(src).toContain("variable: '--font-be-vietnam'")
  })

  it('globals.css dùng biến của next/font, không dùng tên họ font trần', () => {
    const css = readFileSync(resolve(__dirname, '../app/globals.css'), 'utf8')
    expect(css).toMatch(/--font-ui:\s*var\(--font-be-vietnam\)/)
  })

  it('CV dùng CÙNG biến đó — preview và PDF không được lệch font', () => {
    const css = readFileSync(
      resolve(__dirname, '../../../packages/templates/src/styles.css'),
      'utf8',
    )
    expect(css).toMatch(/--cv-font:\s*var\(--font-be-vietnam\)/)
  })

  it('layout.tsx gắn beVietnamPro.variable lên <html> — cả chuỗi trên phụ thuộc dòng này', () => {
    // Toàn bộ chuỗi (lib/fonts.ts khai biến, globals.css và styles.css dùng
    // biến) treo trên MỘT dòng ở layout.tsx gắn `beVietnamPro.variable` lên
    // phần tử <html>. Bốn test phía trên đọc fonts.ts/globals.css/styles.css
    // nên vẫn xanh dù dòng này bị xoá — chúng không đọc layout.tsx. Nếu dòng
    // đó biến mất, `--font-be-vietnam` không còn được định nghĩa và
    // `--cv-font: var(--font-be-vietnam), 'Inter', …` trở thành invalid at
    // computed-value time: font-family KHÔNG rơi về Inter mà kế thừa từ cha —
    // lỗi im lặng, chỉ lộ trong file PDF người dùng đã nộp đi.
    const src = readFileSync(resolve(__dirname, '../app/layout.tsx'), 'utf8')
    const htmlTag = src.match(/<html\b[^>]*>/)?.[0] ?? ''
    expect(htmlTag).toMatch(/beVietnamPro\.variable/)
  })
})
