import { describe, expect, it, afterEach } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { CVSchema } from '@hr/schema'
import { createApp } from '../src/server/app.js'

const cv = CVSchema.parse({
  schemaVersion: 2,
  id: 'cv-print-1',
  title: 'CV thử',
  lastModified: '2026-08-10T00:00:00Z',
  language: 'vi',
  sections: { intro: { fullName: 'Nguyễn Văn A', title: 'Kỹ sư phần mềm', summary: 'Tóm tắt' } },
})

const servers: Array<() => Promise<void>> = []
afterEach(async () => { while (servers.length) await servers.pop()!() })

it('SSR /print render cùng template và đổi được presentation/ats/thumbnail', async () => {
  const backend = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ cv: { ...cv, templateId: 'minimal', theme: {}, layout: {} } }))
  })
  await new Promise<void>((done) => backend.listen(0, '127.0.0.1', done))
  servers.push(() => new Promise<void>((done) => backend.close(() => done())))
  const backendURL = `http://127.0.0.1:${(backend.address() as AddressInfo).port}`
  const app = await createApp({ backendURL, serveApp: false })
  const server = http.createServer(app)
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  servers.push(() => new Promise<void>((done) => server.close(() => done())))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  for (const variant of ['presentation', 'ats', 'thumbnail']) {
    const response = await fetch(`${base}/print/${cv.id}?variant=${variant}`, { headers: { cookie: 'hr_session=test' } })
    const html = await response.text()
    expect(response.status).toBe(200)
    expect(html).toContain(`data-variant="${variant}"`)
    expect(html).toContain('Nguyễn Văn A')
  }
})
