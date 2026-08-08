/// <reference lib="dom" />
// ↑ Chỉ file này cần DOM: callback trong `page.evaluate` chạy TRONG TRÌNH DUYỆT.
//   Không thêm DOM vào tsconfig của package để phần code Node còn lại không vô
//   tình dùng API trình duyệt mà TypeScript vẫn cho qua.

import { chromium, type Browser } from 'playwright'

/**
 * Xuất PDF từ trang /print — TDD §8.4, UC-32.
 *
 * Nguyên tắc (TDD §3.3): DÙNG CHUNG một template với bản xem trước. Playwright
 * chỉ mở đúng trang mà người dùng đã xem, nên preview khớp PDF theo thiết kế
 * chứ không nhờ may mắn.
 *
 * BR-32.2: PDF phải là text-based (chọn được chữ) — Chromium in HTML ra vector
 * + text layer, không phải ảnh. TC-32-03 kiểm chứng bằng `pdftotext`.
 */

export type ExportVariant = 'presentation' | 'ats'

export interface ExportOptions {
  /** URL đầy đủ tới /print/:cvId */
  url: string
  variant: ExportVariant
  timeoutMs?: number
}

export interface ExportResult {
  pdf: Buffer
  bytes: number
  ms: number
}

/**
 * Browser dùng lại giữa các lần xuất. Khởi động Chromium mất ~300-800ms;
 * bật/tắt mỗi lần xuất là lãng phí lớn khi có hàng đợi (UC-72).
 */
let browserPromise: Promise<Browser> | null = null

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      args: [
        // Cần khi chạy trong container không có user namespace
        '--no-sandbox',
        '--disable-dev-shm-usage',
        // Bắt buộc để in được màu nền (chip kỹ năng) — mặc định Chromium bỏ qua
        '--force-color-profile=srgb',
      ],
    })
  }
  return browserPromise
}

export async function closeBrowser(): Promise<void> {
  if (browserPromise) {
    const b = await browserPromise
    await b.close()
    browserPromise = null
  }
}

export async function exportPdf(opts: ExportOptions): Promise<ExportResult> {
  const t0 = Date.now()
  const browser = await getBrowser()
  const context = await browser.newContext({
    // Ép ngôn ngữ để font fallback ưu tiên bộ có dấu tiếng Việt (BR-32.3)
    locale: 'vi-VN',
    // Kích thước gần A4 ở 96dpi — tránh media query màn hình nhỏ ăn vào bản in
    viewport: { width: 900, height: 1200 },
  })
  const page = await context.newPage()

  try {
    const url = `${opts.url}${opts.url.includes('?') ? '&' : '?'}variant=${opts.variant}`
    const res = await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: opts.timeoutMs ?? 30_000,
    })
    if (!res || !res.ok()) {
      throw new Error(`Trang /print trả HTTP ${res?.status() ?? 'không phản hồi'}`)
    }

    // Chờ template render xong. Nếu selector không xuất hiện thì HTML sai —
    // in ra sẽ là trang trắng, thà báo lỗi còn hơn giao file rỗng cho user.
    await page.waitForSelector('.cv-page', { timeout: 10_000 })

    // Font phải nạp xong TRƯỚC khi in, nếu không chữ có dấu render bằng font
    // fallback rồi mới đổi — PDF giữ nguyên bản sai.
    await page.evaluate(() => document.fonts.ready)

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: opts.variant !== 'ats',
      // Lề do .cv-page tự quản (CSS mm) để preview và PDF giống hệt nhau
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      preferCSSPageSize: true,
    })

    return { pdf, bytes: pdf.length, ms: Date.now() - t0 }
  } finally {
    await context.close()
  }
}
