import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import pg from 'pg'
import { exportPdf, closeBrowser } from '../src/export.js'

/**
 * TC-32-01..09 — xuất PDF. CHẠM THẬT: Postgres + Next đang chạy + Chromium.
 *
 * Điều kiện: docker compose up -d postgres && npm run db:migrate
 *            cd apps/web && npx next build && npx next start -p 3100
 * Chạy: npm run test:int
 */

const APP = process.env.APP_URL ?? 'http://localhost:3100'
const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ?? 'postgres://postgres:hragent_dev@localhost:5433/hragent',
})

let cvId: string
let userId: string
let tmp: string

const profile = {
  schemaVersion: 1,
  language: 'vi',
  basics: {
    name: 'Nguyễn Minh Khôi',
    headline: 'Lập trình viên Backend',
    email: 'khoi@example.com',
    phone: '0901234567',
    location: 'Hà Nội',
    links: [],
    summary: 'Sinh viên năm cuối ngành Kỹ thuật phần mềm.',
  },
  education: [
    {
      school: 'ĐH Bách Khoa Hà Nội',
      degree: 'Kỹ sư',
      major: 'Kỹ thuật phần mềm',
      startDate: '2021',
      endDate: '2025',
      gpa: '3.2',
      highlights: [],
    },
  ],
  work: [
    {
      org: 'Công ty ABC',
      role: 'Thực tập sinh Backend',
      startDate: '06/2024',
      endDate: '',
      highlights: ['Tối ưu truy vấn PostgreSQL, giảm từ 4.2s xuống 0.9s'],
    },
  ],
  projects: [],
  skills: [{ name: 'Node.js' }, { name: 'PostgreSQL' }],
  activities: [],
  certifications: [{ name: 'AWS Cloud Practitioner', issuer: 'AWS', date: '2024' }],
  languages: [],
  _meta: { verified: {}, source: 'manual' },
}

const text = (pdf: string, layout = false): string =>
  execFileSync('pdftotext', layout ? ['-layout', pdf, '-'] : [pdf, '-'], {
    encoding: 'utf8',
    maxBuffer: 1 << 24,
  })

const fonts = (pdf: string): string =>
  execFileSync('pdffonts', [pdf], { encoding: 'utf8' })

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'hr-pdf-'))
  const u = await pool.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [`pdf-test-${Date.now()}@example.com`],
  )
  userId = u.rows[0]!.id
  const p = await pool.query<{ id: string }>(
    `INSERT INTO profiles (user_id, data, language) VALUES ($1,$2,'vi') RETURNING id`,
    [userId, profile],
  )
  const c = await pool.query<{ id: string }>(
    `INSERT INTO cv_documents (user_id, profile_id, profile_snapshot, template_id, title)
     VALUES ($1,$2,$3,'elegant','CV kiểm thử') RETURNING id`,
    [userId, p.rows[0]!.id, profile],
  )
  cvId = c.rows[0]!.id
}, 30_000)

afterAll(async () => {
  await closeBrowser()
  await pool.query('DELETE FROM users WHERE id = $1', [userId])
  await pool.end()
  rmSync(tmp, { recursive: true, force: true })
})

describe('TC-32-01/02 — xuất được cả hai bản', () => {
  it('bản trình bày', async () => {
    const r = await exportPdf({ url: `${APP}/print/${cvId}`, variant: 'presentation' })
    expect(r.bytes).toBeGreaterThan(10_000)
    writeFileSync(join(tmp, 'pres.pdf'), r.pdf)
  }, 90_000)

  it('bản ATS', async () => {
    const r = await exportPdf({ url: `${APP}/print/${cvId}`, variant: 'ats' })
    expect(r.bytes).toBeGreaterThan(10_000)
    writeFileSync(join(tmp, 'ats.pdf'), r.pdf)
  }, 90_000)
})

describe('TC-32-03 — PDF phải TEXT-BASED, không phải ảnh', () => {
  it.each(['pres', 'ats'])('%s: pdftotext trả về nội dung', (name) => {
    const t = text(join(tmp, `${name}.pdf`)).replace(/\s/g, '')
    expect(
      t.length,
      'pdftotext rỗng = PDF ảnh = mọi hệ ATS đọc không ra gì',
    ).toBeGreaterThan(300)
  })

  it('đúng khổ A4', () => {
    const info = execFileSync('pdfinfo', [join(tmp, 'pres.pdf')], { encoding: 'utf8' })
    expect(info).toMatch(/Page size:\s+59[45](\.\d+)?\s+x\s+84[12](\.\d+)?/)
  })
})

describe('TC-32-04 — tiếng Việt có dấu (BR-32.3)', () => {
  it.each(['pres', 'ats'])('%s: giữ nguyên dấu', (name) => {
    const t = text(join(tmp, `${name}.pdf`))
    expect(t).toContain('Nguyễn Minh Khôi')
    expect(t).toContain('Kỹ thuật phần mềm')
    expect(t).toContain('Thực tập sinh')
    // Ký tự thay thế = font thiếu glyph
    expect(t).not.toMatch(/�|Nguy\?n|Ph\?n m\?m/)
  })

  it('giữ nguyên số liệu — thứ tạo nên sức nặng của CV', () => {
    const t = text(join(tmp, 'pres.pdf'))
    expect(t).toContain('4.2s')
    expect(t).toContain('0.9s')
  })
})

describe('TC-32-02 — bản ATS khác bản trình bày', () => {
  it('ATS giữ ĐỦ nội dung — ATS-safe không phải cắt bớt', () => {
    const t = text(join(tmp, 'ats.pdf'))
    for (const s of ['Nguyễn Minh Khôi', 'Bách Khoa', 'PostgreSQL', 'AWS Cloud Practitioner']) {
      expect(t).toContain(s)
    }
  })

  it('dùng font khác (serif hệ thống thay vì font trang trí)', () => {
    const a = fonts(join(tmp, 'ats.pdf'))
    const p = fonts(join(tmp, 'pres.pdf'))
    expect(a).not.toBe(p)
    expect(a).toMatch(/Times/i)
  })
})

describe('TC-32-09 — font nhúng đầy đủ (TDD §8.4.1)', () => {
  /*
   * Không đếm cột theo vị trí: `type` có thể là "TrueType" (1 token) hoặc
   * "CID TrueType" (2 token), và "object ID" là HAI token. Đếm từ đầu hay từ
   * cuối đều lệch. Bám vào chính ba cờ yes/no đứng ngay trước object ID.
   */
  const FLAGS = /\b(yes|no)\s+(yes|no)\s+(yes|no)\s+\d+\s+\d+\s*$/

  it.each(['pres', 'ats'])('%s: mọi font đều nhúng và có bảng Unicode', (name) => {
    const rows = fonts(join(tmp, `${name}.pdf`))
      .split('\n')
      .slice(2)
      .filter((l) => l.trim())
    expect(rows.length).toBeGreaterThan(0)

    for (const row of rows) {
      const font = row.trim().split(/\s+/)[0]
      const m = FLAGS.exec(row.trim())
      expect(m, `không đọc được cờ của font ${font}: "${row.trim()}"`).not.toBeNull()
      const [, emb, , uni] = m!
      // emb=no → máy khác mở ra sẽ thay font khác, có thể mất dấu
      expect(emb, `font ${font} không nhúng`).toBe('yes')
      // uni=no → pdftotext không map ngược được, ATS đọc ra rác
      expect(uni, `font ${font} thiếu bảng Unicode`).toBe('yes')
    }
  })
})

describe('Xử lý lỗi — không giao file rỗng', () => {
  it('CV không tồn tại → ném lỗi, KHÔNG trả PDF trắng', async () => {
    await expect(
      exportPdf({
        url: `${APP}/print/00000000-0000-0000-0000-000000000000`,
        variant: 'presentation',
        timeoutMs: 20_000,
      }),
    ).rejects.toThrow()
  }, 60_000)
})
