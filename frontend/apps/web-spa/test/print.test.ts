import { describe, expect, it, afterEach } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { CVSchema, DEFAULT_CV_LAYOUT } from '@hr/schema'
import { createApp } from '../src/server/app.js'
import type { CVEnvelope } from '../src/lib/api.js'
import { printCSSForDesign } from '../src/lib/print-css.js'

const cv = CVSchema.parse({
  schemaVersion: 2,
  id: 'cv-print-1',
  title: 'CV thử',
  lastModified: '2026-08-10T00:00:00Z',
  language: 'vi',
  sections: {
    intro: { fullName: 'Nguyễn Văn A', title: 'Kỹ sư phần mềm', location: 'Hà Nội', summary: 'Tóm tắt', careerObjective: 'Xây hệ thống tin cậy', availability: 'Sẵn sàng sau hai tuần' },
    experience: [{ id: 'exp-print', title: 'Tech Lead', company: 'Acme', teamSize: '8 người', techStack: ['Go', 'React'], highlights: ['Giao hệ thống production'] }],
    projects: [{ id: 'project-print', name: 'Nền tảng CV', role: 'Lead', startDate: '2025', endDate: '2026', link: 'https://project.example', teamSize: '4 người', techStack: ['TypeScript'], contribution: 'Dẫn dắt phát hành', highlights: ['Tăng độ tin cậy'] }],
    education: [{ id: 'edu-print', school: 'Đại học Công nghệ', degree: 'Kỹ sư', fieldOfStudy: 'Khoa học máy tính', startDate: '2020', endDate: '2024', gpa: '3.9', highlights: ['Danh sách danh dự'] }],
    skills: [{ id: 'skill-print', category: 'Backend', skills: ['Go', 'PostgreSQL'] }],
    activities: [{ id: 'activity-print', organization: 'Câu lạc bộ Mã nguồn mở', role: 'Cố vấn', startDate: '2024', endDate: '2025', highlights: ['Hướng dẫn cộng tác viên'] }],
    certifications: [{ id: 'cert-print', name: 'Cloud Professional', issuer: 'Cloud Org', date: '2025', link: 'https://cert.example' }],
    languages: [{ id: 'language-print', language: 'Tiếng Anh', proficiency: 'C1' }],
  },
})

const movedTypes = ['experience', 'footer', 'header', 'summary'] as const
const movedLayout = {
  version: 1 as const,
  nodes: [
    ...movedTypes.map((type) => DEFAULT_CV_LAYOUT.nodes.find((node) => node.type === type)!),
    ...DEFAULT_CV_LAYOUT.nodes.filter((node) => !movedTypes.includes(node.type as typeof movedTypes[number])),
  ],
}

const envelope: CVEnvelope = {
  id: cv.id,
  profileId: 'profile-print-1',
  title: cv.title,
  templateId: 'minimal',
  theme: {},
  layout: movedLayout,
  language: cv.language,
  updatedAt: cv.lastModified,
  profileSnapshot: cv,
  schemaVersion: 2,
  revisionNumber: 3,
}

const servers: Array<() => Promise<void>> = []
afterEach(async () => { while (servers.length) await servers.pop()!() })

it('builds print page margins from the editable padding settings alone', () => {
  const css = printCSSForDesign({
    font: 'Auto', fontSize: 10.5, bodyFontSize: 10.5, sectionTitleFontSize: 13, headerFontSize: 20,
    spacing: 'normal', paddingTop: 12, paddingBottom: 14, paddingLeft: 16, paddingRight: 18, pageMargin: 2, lineHeight: 1.4, textAlign: 'justify',
  })
  expect(css).toContain('@page{size:A4;margin:12mm 18mm 14mm 16mm}')
})

it('SSR /print render cùng template và đổi được presentation/ats/thumbnail', async () => {
  const backend = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ cv: envelope }))
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
    expect(html).toContain('Câu lạc bộ Mã nguồn mở')
    expect(html).toContain('Dẫn dắt phát hành')
    expect(html).toContain('https://cert.example')
    expect(html).toContain('data-cv-field="techStack"')
    expect(html).toContain('data-print-style="tags"')
    expect(html).toContain('@page{size:A4;margin:20mm 20mm 20mm 20mm}')
    expect(html).toContain('line-height:var(--cv-line-height,1.3)')
    expect(html).toContain('--cv-line-height:1.3')
    expect(html).toContain('.cv-page{width:210mm;min-height:297mm;padding:var(--cv-padding-top,20mm)')
    expect(html.indexOf('data-cv-node="footer"')).toBeGreaterThan(html.indexOf('data-cv-node="experience"'))
    expect(html.indexOf('data-cv-node="header"')).toBeGreaterThan(html.indexOf('data-cv-node="footer"'))
  }
})

it('SSR /print rejects an upstream envelope whose committed snapshot is invalid', async () => {
  const backend = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ cv: { ...envelope, profileSnapshot: { id: cv.id } } }))
  })
  await new Promise<void>((done) => backend.listen(0, '127.0.0.1', done))
  servers.push(() => new Promise<void>((done) => backend.close(() => done())))
  const app = await createApp({ backendURL: `http://127.0.0.1:${(backend.address() as AddressInfo).port}`, serveApp: false })
  const server = http.createServer(app)
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  servers.push(() => new Promise<void>((done) => server.close(() => done())))

  const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/print/${cv.id}`)
  expect(response.status).toBe(502)
  expect(await response.text()).toContain('CV không hợp lệ')
})

it('SSR /print preserves registered fallback fields and print-style markup from the real envelope', async () => {
  const hiddenHeaderLayout = {
    ...movedLayout,
    nodes: movedLayout.nodes.map((node) => node.type === 'header' ? { ...node, visible: false } : node),
  }
  const stored = CVSchema.parse({
    ...cv,
    sections: {
      ...cv.sections,
      intro: { ...cv.sections.intro, website: 'https://ada.example', avatarUrl: 'https://ada.example/avatar.png' },
      experience: [{ ...cv.sections.experience[0]!, current: true }],
    },
    layout: hiddenHeaderLayout,
  })
  const actualEnvelope: CVEnvelope = { ...envelope, profileSnapshot: stored, layout: hiddenHeaderLayout }
  const backend = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ cv: actualEnvelope }))
  })
  await new Promise<void>((done) => backend.listen(0, '127.0.0.1', done))
  servers.push(() => new Promise<void>((done) => backend.close(() => done())))
  const app = await createApp({ backendURL: `http://127.0.0.1:${(backend.address() as AddressInfo).port}`, serveApp: false })
  const server = http.createServer(app)
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  servers.push(() => new Promise<void>((done) => server.close(() => done())))

  const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/print/${cv.id}`)
  const html = await response.text()
  expect(response.status).toBe(200)
  expect(html).toContain('Location: Hà Nội')
  expect(html).toContain('https://ada.example')
  expect(html).toContain('data-cv-field="avatarUrl"')
  expect(html).toContain('Present')
  expect(html).toContain('class="cv-field-tags"')
  expect(html).toContain('class="cv-field-tag"')
  expect(html).toContain('.cv-field-tags')
})
