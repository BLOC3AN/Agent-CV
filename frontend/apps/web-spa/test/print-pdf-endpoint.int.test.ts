import { describe, expect, it, afterAll, afterEach } from 'vitest'
import http from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { CVSchema, DEFAULT_CV_LAYOUT } from '@hr/schema'
import { createApp } from '../src/server/app.js'
import { closePrintBrowser } from '../src/server/print.js'
import type { CVEnvelope } from '../src/lib/api.js'

const run = promisify(execFile)
const tempDirs: string[] = []

const cv = CVSchema.parse({
  schemaVersion: 2,
  id: 'cv-pdf-endpoint',
  title: 'CV tải về',
  lastModified: '2026-08-10T00:00:00Z',
  language: 'vi',
  sections: {
    intro: { fullName: 'Nguyễn Văn Tải', title: 'Kỹ sư phần mềm', summary: 'Dựng hệ thống tin cậy', location: 'Hà Nội' },
    experience: [{ id: 'exp-pdf', title: 'Tech Lead', company: 'Acme', startDate: '2024', endDate: '', current: true, highlights: ['Giao hệ thống production'] }],
  },
})

const envelope: CVEnvelope = {
  id: cv.id,
  profileId: 'profile-pdf',
  title: cv.title,
  templateId: 'minimal',
  theme: {},
  layout: DEFAULT_CV_LAYOUT,
  language: cv.language,
  updatedAt: cv.lastModified,
  profileSnapshot: cv,
  schemaVersion: 2,
  revisionNumber: 1,
}

const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  while (closers.length) await closers.pop()!()
  while (tempDirs.length) await rm(tempDirs.pop()!, { recursive: true, force: true })
})
// Chromium dùng chung sống ngoài vòng đời request; bỏ quên thì vitest treo.
afterAll(async () => { await closePrintBrowser() })

/** Backend giả trả đúng envelope mà print handler mong đợi. */
async function startStack(respond?: (req: http.IncomingMessage, res: http.ServerResponse) => boolean) {
  const backend = http.createServer((req, res) => {
    if (respond?.(req, res)) return
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ cv: envelope }))
  })
  await new Promise<void>((done) => backend.listen(0, '127.0.0.1', done))
  const app = await createApp({ backendURL: `http://127.0.0.1:${(backend.address() as AddressInfo).port}`, serveApp: false })
  const server = http.createServer(app)
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  closers.push(async () => {
    await new Promise<void>((done) => server.close(() => done()))
    await new Promise<void>((done) => backend.close(() => done()))
  })
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

async function pdfText(body: ArrayBuffer): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'hr-pdf-endpoint-'))
  tempDirs.push(dir)
  const file = path.join(dir, 'cv.pdf')
  await writeFile(file, Buffer.from(body))
  const { stdout } = await run('pdftotext', ['-layout', file, '-'])
  return stdout
}

describe('GET /print/:cvId/pdf', () => {
  it('trả về file PDF thật kèm tên file để trình duyệt lưu xuống máy', async () => {
    const base = await startStack()

    const response = await fetch(`${base}/print/${cv.id}/pdf`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/pdf')
    // Thiếu header này thì trình duyệt mở PDF trong tab thay vì lưu về máy.
    expect(response.headers.get('content-disposition')).toMatch(/^attachment; filename/)
    const body = await response.arrayBuffer()
    expect(Buffer.from(body).subarray(0, 5).toString()).toBe('%PDF-')
  }, 120_000)

  /*
   * Text layer là thứ ATS đọc. Một PDF chỉ chứa ảnh chụp trang vẫn mở được
   * bằng mắt nhưng máy quét ra rỗng — nên đây là khẳng định quan trọng nhất.
   */
  it('giữ chữ ở dạng chọn được, không phải ảnh chụp trang', async () => {
    const base = await startStack()

    const response = await fetch(`${base}/print/${cv.id}/pdf`)
    const text = await pdfText(await response.arrayBuffer())

    expect(text).toContain('Nguyễn Văn Tải')
    expect(text).toContain('Acme')
  }, 120_000)

  it('in đúng khổ A4', async () => {
    const base = await startStack()

    const response = await fetch(`${base}/print/${cv.id}/pdf`)
    const dir = await mkdtemp(path.join(tmpdir(), 'hr-pdf-endpoint-'))
    tempDirs.push(dir)
    const file = path.join(dir, 'cv.pdf')
    await writeFile(file, Buffer.from(await response.arrayBuffer()))
    const { stdout } = await run('pdfinfo', [file])

    expect(stdout).toMatch(/Page size:\s+\d+(?:\.\d+)? x \d+(?:\.\d+)? pts \(A4\)/)
  }, 120_000)

  it('chuyển tiếp lỗi của backend thay vì trả PDF rỗng', async () => {
    const base = await startStack((_req, res) => {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('không thấy CV')
      return true
    })

    const response = await fetch(`${base}/print/${cv.id}/pdf`)

    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).not.toContain('application/pdf')
  }, 120_000)
})
