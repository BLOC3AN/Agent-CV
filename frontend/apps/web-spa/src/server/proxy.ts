import type { Request as ExpressRequest, Response as ExpressResponse } from 'express'
import { Readable } from 'node:stream'

/**
 * Header từng-chặng — thuộc về một kết nối TCP cụ thể, không được chuyển tiếp.
 * `content-length` cũng nằm đây: `fetch` tự tính lại, giữ giá trị cũ thì
 * trình duyệt cắt cụt response.
 *
 * `content-encoding` cũng vậy: `fetch` (undici) tự giải nén thân response
 * trước khi trả về — `upstream.body` đã là dữ liệu thô, không còn nén. Giữ
 * lại header `content-encoding: gzip` của backend mà chuyển tiếp thân đã giải
 * nén thì trình duyệt sẽ cố giải nén một lần nữa và hỏng response.
 */
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length',
  'content-encoding',
])

/**
 * Chuyển tiếp mọi request `/api/*` sang backend Go.
 *
 * Bốn chi tiết dễ sai, mỗi cái đều làm hỏng một tính năng thật:
 *
 *  1. `redirect: 'manual'` — `GET /api/auth/verify` trả 302 về trang chủ. Để
 *     `fetch` tự đi theo thì proxy trả về HTML trang chủ với mã 200, và trình
 *     duyệt không bao giờ nhận được cookie phiên.
 *  2. `getSetCookie()` — `Headers.get('set-cookie')` gộp nhiều cookie thành
 *     một chuỗi ngăn bởi dấu phẩy, mà `Expires=` cũng chứa dấu phẩy. Gộp rồi
 *     tách lại là hỏng.
 *  3. Ống dẫn luồng, không `await res.text()` — SSE của `/api/chat` (SP-4)
 *     không bao giờ kết thúc, đọc hết thân response nghĩa là treo vĩnh viễn.
 *  4. `content-encoding` bị lọc khỏi response — `fetch` đã tự giải nén thân
 *     response, giữ lại header nói "còn nén" thì trình duyệt giải nén hai lần.
 */
export function createApiProxy(backendURL: string) {
  const base = backendURL.replace(/\/$/, '')

  return async function apiProxy(req: ExpressRequest, res: ExpressResponse): Promise<void> {
    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined || HOP_BY_HOP.has(key)) continue
      headers.set(key, Array.isArray(value) ? value.join(', ') : value)
    }

    const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
    let upstream: Response
    try {
      upstream = await fetch(base + req.originalUrl, {
        method: req.method,
        headers,
        body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
        // Bắt buộc khi thân request là luồng — undici từ chối nếu thiếu.
        ...(hasBody ? { duplex: 'half' } : {}),
        redirect: 'manual',
      } as RequestInit)
    } catch {
      res.status(502).json({ error: 'Không kết nối được backend' })
      return
    }

    res.status(upstream.status)
    upstream.headers.forEach((value, key) => {
      if (HOP_BY_HOP.has(key) || key === 'set-cookie') return
      res.setHeader(key, value)
    })
    const cookies = upstream.headers.getSetCookie()
    if (cookies.length > 0) res.setHeader('set-cookie', cookies)

    if (!upstream.body) {
      res.end()
      return
    }
    Readable.fromWeb(upstream.body as never).pipe(res)
  }
}
