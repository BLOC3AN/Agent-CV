import type { RequestHandler } from 'express'
import type { CSSProperties } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CVLayoutSchema, CVSchema } from '@hr/schema'
import { CVBlockRenderer } from '../components/CVBlockRenderer'
import type { CV as WebCV, CVLayout as WebCVLayout } from '../types'
import type { CVEnvelope } from '../lib/api'
import { printCSSForDesign } from '../lib/print-css'
import { cvTypographyStyle } from '../lib/cv-typography'

interface Envelope {
  cv?: Partial<CVEnvelope>
}

function PrintDocument({ cv, layout, variant }: { cv: WebCV; layout: WebCVLayout; variant: 'presentation' | 'ats' | 'thumbnail' }) {
  return <main className="cv-root" data-variant={variant} style={{ '--cv-accent': cv.design.accentColor, ...cvTypographyStyle(cv.design) } as CSSProperties}>
    <article className="cv-page">
      <CVBlockRenderer cv={cv} layout={layout} variant="print" />
    </article>
  </main>
}

function escapeTitle(value: string): string {
  return value.replace(/[<>&"']/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[character] ?? character))
}

type PrintVariant = 'presentation' | 'ats' | 'thumbnail'
type BuiltPage =
  | { ok: true; html: string; title: string; variant: PrintVariant }
  | { ok: false; status: number; message: string }

/**
 * Phải là type guard tường minh, không thể viết `if (!page.ok)`.
 *
 * Project này không bật `strict`, và thiếu `strictNullChecks` thì TypeScript
 * KHÔNG thu hẹp union theo discriminant kiểu boolean — `page.status` sau đó báo
 * "không tồn tại trên BuiltPage". Cùng đoạn mã ấy biên dịch sạch dưới `--strict`,
 * nên đây là cái bẫy chỉ lộ ra ở cấu hình của repo này.
 */
function isFailure(page: BuiltPage): page is Extract<BuiltPage, { ok: false }> {
  return !page.ok
}

function variantOf(value: unknown): PrintVariant {
  return value === 'ats' || value === 'thumbnail' ? value : 'presentation'
}

/**
 * Dựng trang in cho một CV — nguồn sự thật DUY NHẤT cho cả hai đầu ra.
 *
 * Route HTML và route PDF cùng gọi hàm này, nên bản in tải về không thể trôi
 * lệch khỏi bản hiển thị: cả hai là cùng một chuỗi HTML.
 */
async function buildPrintPage(backendURL: string, cvId: string, variant: PrintVariant, cookie: string): Promise<BuiltPage> {
  if (!cvId) return { ok: false, status: 400, message: 'Mã CV không hợp lệ' }
  let upstream: Response
  try {
    upstream = await fetch(`${backendURL.replace(/\/$/, '')}/api/cv/${encodeURIComponent(cvId)}`, {
      headers: { cookie, 'X-CV-Schema': '2' },
    })
  } catch {
    return { ok: false, status: 502, message: 'Không kết nối được backend' }
  }
  if (!upstream.ok) return { ok: false, status: upstream.status, message: await upstream.text() }
  let body: Envelope
  try {
    body = await upstream.json() as Envelope
  } catch {
    return { ok: false, status: 502, message: 'Dữ liệu CV không hợp lệ' }
  }
  const cvResult = CVSchema.safeParse(body.cv?.profileSnapshot)
  const layoutResult = CVLayoutSchema.safeParse(body.cv?.layout)
  if (!cvResult.success || !layoutResult.success) {
    return { ok: false, status: 502, message: 'Dữ liệu CV không hợp lệ' }
  }
  const cv = cvResult.data as unknown as WebCV
  const layout = layoutResult.data as unknown as WebCVLayout
  const rawTitle = typeof body.cv?.title === 'string' && body.cv.title ? body.cv.title : cv.title
  const title = escapeTitle(rawTitle)
  const html = `<!doctype html><html lang="${cv.language === 'en' ? 'en' : 'vi'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${printCSSForDesign(cv.design)}</style></head><body>${renderToStaticMarkup(<PrintDocument cv={cv} layout={layout} variant={variant} />)}</body></html>`
  return { ok: true, html, title: rawTitle, variant }
}

export function createPrintHandler(backendURL: string): RequestHandler {
  return async (req, res) => {
    const page = await buildPrintPage(backendURL, String(req.params.cvId ?? ''), variantOf(req.query.variant), req.headers.cookie ?? '')
    if (isFailure(page)) { res.status(page.status).send(page.message); return }
    res.type('html').send(page.html)
  }
}

/**
 * Một trình duyệt dùng chung cho mọi yêu cầu xuất PDF.
 *
 * Khởi động chromium mất vài trăm mili-giây và ngốn hàng trăm MB; bật riêng
 * cho từng yêu cầu là cách nhanh nhất để hạ gục container dưới tải. Mỗi yêu
 * cầu vẫn có `BrowserContext` riêng nên không dùng chung state.
 */
let browserPromise: Promise<import('playwright').Browser> | undefined

async function sharedBrowser() {
  if (!browserPromise) {
    browserPromise = import('playwright').then(({ chromium }) => chromium.launch({ headless: true }))
    // Lần bật hỏng không được đóng băng vĩnh viễn — xoá cache để lần sau thử lại.
    browserPromise.catch(() => { browserPromise = undefined })
  }
  return browserPromise
}

/** Đóng trình duyệt dùng chung (tắt máy chủ có trật tự, và dọn sau mỗi test). */
export async function closePrintBrowser(): Promise<void> {
  const pending = browserPromise
  browserPromise = undefined
  if (pending) await pending.then((browser) => browser.close()).catch(() => undefined)
}

/**
 * Tên file người dùng nhìn thấy khi lưu xuống máy.
 *
 * Gửi kèm cả hai dạng: `filename` ASCII cho trình duyệt cũ, và `filename*`
 * theo RFC 5987 để tên tiếng Việt có dấu không bị bóp méo.
 */
function contentDisposition(title: string): string {
  const base = (title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'CV').slice(0, 80)
  const ascii = base.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w .-]+/g, '_') || 'CV'
  return `attachment; filename="${ascii}.pdf"; filename*=UTF-8''${encodeURIComponent(`${base}.pdf`)}`
}

export function createPrintPDFHandler(backendURL: string): RequestHandler {
  return async (req, res) => {
    const page = await buildPrintPage(backendURL, String(req.params.cvId ?? ''), variantOf(req.query.variant), req.headers.cookie ?? '')
    if (isFailure(page)) { res.status(page.status).type('text/plain').send(page.message); return }

    let pdf: Buffer
    try {
      const browser = await sharedBrowser()
      const context = await browser.newContext()
      try {
        const tab = await context.newPage()
        await tab.setContent(page.html, { waitUntil: 'networkidle' })
        await tab.evaluate(async () => { await document.fonts?.ready })
        pdf = await tab.pdf({
          format: 'A4',
          printBackground: page.variant !== 'ats',
          preferCSSPageSize: true,
          margin: { top: '0', right: '0', bottom: '0', left: '0' },
        })
      } finally {
        await context.close()
      }
    } catch {
      res.status(500).type('text/plain').send('Không dựng được PDF')
      return
    }

    res.status(200)
    res.type('application/pdf')
    res.setHeader('Content-Disposition', contentDisposition(page.title))
    res.send(pdf)
  }
}
