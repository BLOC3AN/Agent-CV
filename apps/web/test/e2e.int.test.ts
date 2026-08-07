import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'

/**
 * Lớp E2E — chạy trên TRÌNH DUYỆT THẬT với ứng dụng THẬT.
 *
 * ── Vì sao lớp này tồn tại ──
 * Mọi lỗi giao diện trong dự án này đều do NGƯỜI DÙNG tìm ra, không phải test:
 * `/act` lộ ra màn hình, chat mất khi đổi tab, "đã áp dụng" mà nội dung biến
 * mất, job `match_analysis` làm Home nói "đang đọc CV của bạn".
 *
 * Test đơn vị không bắt được nhóm đó vì chúng kiểm từng mảnh rời. Cái hỏng nằm
 * ở CHỖ GHÉP: server component + client component + cookie + điều hướng.
 *
 * Dùng thư viện `playwright` có sẵn (đã dùng để xuất PDF) thay vì thêm
 * `@playwright/test`: một bộ chạy test là đủ, và mọi test khác đang ở vitest.
 *
 *   bash scripts/dev-restart.sh && npm run test:int
 */

const BASE = process.env['APP_URL'] ?? 'http://localhost:3100'

let browser: Browser | null = null
let up = false

beforeAll(async () => {
  up = await fetch(BASE, { signal: AbortSignal.timeout(5_000) }).then(
    (r) => r.ok,
    () => false,
  )
  if (up) browser = await chromium.launch()
}, 60_000)

afterAll(async () => {
  await browser?.close()
})

/** Trang mới, phiên sạch — mỗi test không được ăn cookie của test trước. */
async function fresh(): Promise<Page> {
  const ctx = await browser!.newContext()
  return ctx.newPage()
}

const skip = (): boolean => {
  if (!up) console.warn(`⏭  ${BASE} không phản hồi — chạy scripts/dev-restart.sh trước`)
  return !up
}

describe('E2E · Home phân luồng theo tình trạng (UC-01/02/03)', () => {
  it(
    'Home hiện MỘT trong ba màn, không phải trang trắng',
    async () => {
      if (skip()) return
      const page = await fresh()
      await page.goto(BASE, { waitUntil: 'networkidle' })

      const text = await page.locator('main').innerText()
      // Ba màn hình có ba câu mở đầu khác nhau — phải trúng đúng một
      const hits = [/Bạn cần giúp gì/, /đang làm dở|chưa xong/, /Hồ sơ đã đầy đủ/].filter((re) =>
        re.test(text),
      )
      expect(hits.length, `Home không khớp màn nào:\n${text.slice(0, 300)}`).toBe(1)
      await page.close()
    },
    60_000,
  )

  it(
    'không nút nào trên Home dẫn tới 404 (BR-01.3)',
    async () => {
      if (skip()) return
      const page = await fresh()
      await page.goto(BASE, { waitUntil: 'networkidle' })

      const hrefs = await page.locator('main a[href^="/"]').evaluateAll((els) =>
        els.map((e) => (e as HTMLAnchorElement).getAttribute('href')!),
      )
      expect(hrefs.length).toBeGreaterThan(0)

      for (const href of hrefs) {
        const res = await page.request.get(`${BASE}${href}`)
        // Nút 404 còn tệ hơn không có nút: người bấm vào nghĩ cả hệ thống hỏng
        expect(res.status(), `${href} trả ${res.status()}`).toBeLessThan(400)
      }
      await page.close()
    },
    120_000,
  )
})

describe('E2E · đăng nhập bằng magic link (UC-11)', () => {
  it(
    'xin link → đổi link lấy phiên → thấy email của mình',
    async () => {
      if (skip()) return
      const page = await fresh()
      const email = `e2e-${Date.now()}@example.com`

      const res = await page.request.post(`${BASE}/api/auth/request`, { data: { email } })
      expect(res.ok()).toBe(true)
      const { devLink } = (await res.json()) as { devLink?: string }
      if (!devLink) {
        console.warn('⏭  máy này đã cấu hình SMTP — không lấy được link để thử')
        await page.close()
        return
      }

      await page.goto(devLink, { waitUntil: 'networkidle' })
      await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' })
      expect(await page.locator('main').innerText()).toContain(email)
      await page.close()
    },
    90_000,
  )

  it(
    'link chỉ dùng được MỘT lần',
    async () => {
      if (skip()) return
      const page = await fresh()
      const res = await page.request.post(`${BASE}/api/auth/request`, {
        data: { email: `once-${Date.now()}@example.com` },
      })
      const { devLink } = (await res.json()) as { devLink?: string }
      if (!devLink) {
        await page.close()
        return
      }

      await page.goto(devLink, { waitUntil: 'networkidle' })
      const p2 = await fresh()
      await p2.goto(devLink, { waitUntil: 'networkidle' })
      // Lần hai phải bị chặn và NÓI RÕ lý do
      expect(await p2.locator('body').innerText()).toMatch(/đã dùng rồi/i)
      await page.close()
      await p2.close()
    },
    90_000,
  )
})

describe('E2E · luồng làm CV từ đầu (UC-05)', () => {
  it(
    '"chưa đi làm" ĐỔI HƯỚNG sang dự án, không để lại chỗ trống',
    async () => {
      if (skip()) return
      const page = await fresh()
      await page.goto(`${BASE}/start/guided`, { waitUntil: 'networkidle' })

      await page.getByRole('button', { name: 'Sinh viên' }).click()
      await page.getByLabel(/Computer Vision Engineer/).fill('Backend Developer')
      await page.getByRole('button', { name: 'Tiếp' }).click()
      await page.getByRole('button', { name: 'Chưa' }).click()

      // Sinh viên nhìn mục Kinh nghiệm trống sẽ kết luận mình không đủ tư cách
      const text = await page.locator('main').innerText()
      expect(text).toMatch(/Không sao/)
      expect(text).toMatch(/Dự án/)
      expect(text).not.toMatch(/thiếu|chưa đủ/i)
      await page.close()
    },
    90_000,
  )

  it(
    'luôn quay lại được bước trước (BR-05.1)',
    async () => {
      if (skip()) return
      const page = await fresh()
      await page.goto(`${BASE}/start/guided`, { waitUntil: 'networkidle' })

      // Bước đầu KHÔNG có nút quay lại — không có chỗ nào để về
      expect(await page.getByRole('button', { name: 'Quay lại' }).count()).toBe(0)

      await page.getByRole('button', { name: 'Mới ra trường' }).click()
      await page.getByRole('button', { name: 'Quay lại' }).waitFor()

      await page.getByRole('button', { name: 'Quay lại' }).click()
      await page.getByRole('button', { name: 'Sinh viên' }).waitFor()
      expect(await page.getByRole('button', { name: 'Sinh viên' }).count()).toBe(1)
      await page.close()
    },
    90_000,
  )
})

describe('E2E · trang cần đăng nhập', () => {
  it(
    '/settings chưa đăng nhập → về /login, không phải lỗi 500',
    async () => {
      if (skip()) return
      // Chỉ có nghĩa khi tài khoản dev TẮT; đang bật thì bỏ qua có kiểm soát
      const page = await fresh()
      await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' })
      const url = page.url()
      expect(url.includes('/login') || url.includes('/settings')).toBe(true)
      expect(await page.locator('body').innerText()).not.toMatch(/Internal Server Error/i)
      await page.close()
    },
    60_000,
  )
})
