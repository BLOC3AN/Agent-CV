import { describe, expect, it, afterEach } from 'vitest'
import http from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { CVSchema } from '@hr/schema'
import { createApp } from '../src/server/app.js'

const run = promisify(execFile)
const tempDirs: string[] = []
const cv = CVSchema.parse({
  schemaVersion: 2,
  id: 'cv-print-e2e',
  title: 'CV E2E',
  lastModified: '2026-08-10T00:00:00Z',
  language: 'en',
  sections: { intro: { fullName: 'Real PDF Candidate', title: 'Engineer', summary: 'Built systems' } },
})

const longCv = CVSchema.parse({
  ...cv,
  id: 'cv-print-e2e-long',
  sections: {
    ...cv.sections,
    experience: Array.from({ length: 6 }, (_, index) => ({
      id: `experience-${index}`,
      title: 'Senior AI Engineer',
      company: `Company ${index + 1}`,
      startDate: '2020',
      endDate: 'Present',
      current: index === 0,
      highlights: Array.from({ length: 9 }, (_, bullet) =>
        `Delivered production machine learning systems with measurable reliability, performance, and business impact across multiple teams (item ${index + 1}.${bullet + 1}).`,
      ),
    })),
  },
})

const movedLongLayout = {
  version: 1 as const,
  nodes: [
    { id: 'experience', type: 'experience' as const, visible: true },
    { id: 'footer', type: 'footer' as const, visible: true },
    { id: 'header', type: 'header' as const, visible: true },
    { id: 'summary', type: 'summary' as const, visible: true },
  ],
}

afterEach(async () => { while (tempDirs.length) await rm(tempDirs.pop()!, { recursive: true, force: true }) })

describe('real Playwright print', () => {
  it('renders SSR print route to a non-empty A4 PDF', async () => {
    const backend = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ cv: { ...cv, templateId: 'elegant', theme: {}, layout: {} } }))
    })
    await new Promise<void>((done) => backend.listen(0, '127.0.0.1', done))
    const appServer = http.createServer(await createApp({ backendURL: `http://127.0.0.1:${(backend.address() as AddressInfo).port}`, serveApp: false }))
    await new Promise<void>((done) => appServer.listen(0, '127.0.0.1', done))
    const dir = await mkdtemp(path.join(tmpdir(), 'hr-print-e2e-'))
    tempDirs.push(dir)
    const output = path.join(dir, 'cv.pdf')
    const cli = path.resolve('apps/web-spa/scripts/render-pdf.ts')
    const tsx = path.resolve('node_modules/tsx/dist/cli.mjs')
    try {
      await run(process.execPath, [tsx, cli, '--url', `http://127.0.0.1:${(appServer.address() as AddressInfo).port}/print/${cv.id}?variant=presentation`, '--output', output])
      const pdf = await readFile(output)
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
      const { stdout } = await run('pdfinfo', [output])
      expect(stdout).toMatch(/Page size:\s+\d+(?:\.\d+)? x \d+(?:\.\d+)? pts \(A4\)/)
    } finally {
      await new Promise<void>((done) => appServer.close(() => done()))
      await new Promise<void>((done) => backend.close(() => done()))
    }
  }, 60_000)

  it('keeps a long CV as multiple A4 pages instead of clipping it to one page', async () => {
    const backend = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ cv: { ...longCv, templateId: 'elegant', theme: {}, layout: movedLongLayout } }))
    })
    await new Promise<void>((done) => backend.listen(0, '127.0.0.1', done))
    const appServer = http.createServer(await createApp({ backendURL: `http://127.0.0.1:${(backend.address() as AddressInfo).port}`, serveApp: false }))
    await new Promise<void>((done) => appServer.listen(0, '127.0.0.1', done))
    const dir = await mkdtemp(path.join(tmpdir(), 'hr-print-e2e-long-'))
    tempDirs.push(dir)
    const output = path.join(dir, 'long-cv.pdf')
    const cli = path.resolve('apps/web-spa/scripts/render-pdf.ts')
    const tsx = path.resolve('node_modules/tsx/dist/cli.mjs')
    try {
      await run(process.execPath, [tsx, cli, '--url', `http://127.0.0.1:${(appServer.address() as AddressInfo).port}/print/${longCv.id}?variant=presentation`, '--output', output])
      const { stdout } = await run('pdfinfo', [output])
      const pages = Number(stdout.match(/Pages:\s+(\d+)/)?.[1] ?? 0)
      expect(pages).toBeGreaterThanOrEqual(3)
      expect(stdout).toMatch(/Page size:\s+\d+(?:\.\d+)? x \d+(?:\.\d+)? pts \(A4\)/)
    } finally {
      await new Promise<void>((done) => appServer.close(() => done()))
      await new Promise<void>((done) => backend.close(() => done()))
    }
  }, 60_000)
})
