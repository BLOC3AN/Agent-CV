import { describe, expect, it, afterEach } from 'vitest'
import http from 'node:http'
import zlib from 'node:zlib'
import type { AddressInfo } from 'node:net'
import { createApp } from '../src/server/app.js'

/** Backend Go giả — ghi lại request nhận được và trả về thứ ta dặn trước. */
function fakeBackend(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      })
    })
  })
}

async function startApp(backendURL: string) {
  // `serveApp: false` — test này chỉ quan tâm lớp proxy. Bật lớp phục vụ giao
  // diện sẽ dựng một Vite dev server với thư mục gốc sai (vitest chạy từ
  // `frontend/`, không phải `frontend/apps/web-spa/`), và test đỏ vì một lý do
  // chẳng liên quan gì tới thứ đang được kiểm.
  const app = await createApp({ backendURL, serveApp: false })
  const server = http.createServer(app)
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', () => done()))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((done) => server.close(() => done())),
  }
}

const openServers: Array<() => Promise<void>> = []
afterEach(async () => {
  while (openServers.length) await openServers.pop()!()
})

describe('proxy /api', () => {
  it('chuyển tiếp cookie phiên lên backend', async () => {
    let seen = ''
    const backend = await fakeBackend((req, res) => {
      seen = req.headers.cookie ?? ''
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"items":[]}')
    })
    openServers.push(backend.close)
    const app = await startApp(backend.url)
    openServers.push(app.close)

    const res = await fetch(`${app.url}/api/cv`, {
      headers: { cookie: 'hr_session=abc123' },
    })

    expect(res.status).toBe(200)
    expect(seen).toBe('hr_session=abc123')
  })

  it('trả set-cookie của backend về trình duyệt', async () => {
    const backend = await fakeBackend((_req, res) => {
      res.writeHead(200, {
        'set-cookie': 'hr_session=xyz; Path=/; HttpOnly',
        'content-type': 'application/json',
      })
      res.end('{"ok":true}')
    })
    openServers.push(backend.close)
    const app = await startApp(backend.url)
    openServers.push(app.close)

    const res = await fetch(`${app.url}/api/auth/logout`, { method: 'POST' })

    expect(res.headers.getSetCookie()).toEqual([
      'hr_session=xyz; Path=/; HttpOnly',
    ])
  })

  it('không tự đi theo redirect — trả 302 và Location cho trình duyệt', async () => {
    const backend = await fakeBackend((_req, res) => {
      res.writeHead(302, { location: 'http://localhost:3002/' })
      res.end()
    })
    openServers.push(backend.close)
    const app = await startApp(backend.url)
    openServers.push(app.close)

    const res = await fetch(`${app.url}/api/auth/verify?token=t`, {
      redirect: 'manual',
    })

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('http://localhost:3002/')
  })

  it('chuyển tiếp thân request POST nguyên vẹn', async () => {
    let body = ''
    const backend = await fakeBackend((req, res) => {
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        res.writeHead(201, { 'content-type': 'application/json' })
        res.end('{"id":"cv-1"}')
      })
    })
    openServers.push(backend.close)
    const app = await startApp(backend.url)
    openServers.push(app.close)

    const res = await fetch(`${app.url}/api/cv`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'CV thử' }),
    })

    expect(res.status).toBe(201)
    expect(JSON.parse(body)).toEqual({ title: 'CV thử' })
  })

  it('không chuyển tiếp content-encoding — fetch đã tự giải nén thân response', async () => {
    // `fetch` (undici) tự giải nén thân response nhưng KHÔNG xoá header
    // `content-encoding` khỏi `upstream.headers`. Backend giả nén gzip thật
    // sự để tái hiện đúng tình huống: nếu proxy chuyển tiếp header này
    // nguyên vẹn, trình duyệt nhận thân đã giải nén nhưng header nói "còn
    // nén gzip" — cố giải nén lần hai và hỏng response.
    const plain = '{"items":["a","b"]}'
    const gzipped = zlib.gzipSync(plain)
    const backend = await fakeBackend((_req, res) => {
      res.writeHead(200, {
        'content-encoding': 'gzip',
        'content-type': 'application/json',
      })
      res.end(gzipped)
    })
    openServers.push(backend.close)
    const app = await startApp(backend.url)
    openServers.push(app.close)

    const res = await fetch(`${app.url}/api/cv`)

    expect(res.headers.get('content-encoding')).toBeNull()
    expect(await res.text()).toBe(plain)
  })

  it('backend chết thì trả 502 kèm thông điệp tiếng Việt', async () => {
    // Cổng 1 chắc chắn không có gì lắng nghe.
    const app = await startApp('http://127.0.0.1:1')
    openServers.push(app.close)

    const res = await fetch(`${app.url}/api/cv`)

    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'Không kết nối được backend' })
  })
})
