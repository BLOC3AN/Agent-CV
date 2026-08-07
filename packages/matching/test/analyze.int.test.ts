import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Gateway, ProviderRegistry, parseJDTask } from '@hr/ai'
import { ProfileSchema, type JDRequirements, type Profile } from '@hr/schema'
import { analyze } from '../src/analyze.js'
import { taxonomy } from '../src/taxonomy.js'
import { rubrics } from '../src/kb-load.js'

/**
 * TC-42-* — đối chiếu trên JD THẬT với hạ tầng thật.
 *
 * Test đơn vị chứng minh phép tính đúng. Test này chứng minh kết quả CÓ NGHĨA:
 * CV hợp việc phải cao điểm hơn CV không hợp, và mọi khớp phải chỉ ra được chỗ
 * trong CV.
 *
 *   npm run test:int
 */

const JD_DIR = resolve(import.meta.dirname, '../../../eval/jd')

let gw: Gateway
let embedder: { embedBatch(t: string[]): Promise<number[][]> } | null = null
let up = false

beforeAll(async () => {
  gw = new Gateway()
  try {
    up = await gw.health().then((h) => h.models['local.reasoner'] === true)
    embedder = new ProviderRegistry().embed()
  } catch {
    embedder = null
  }
}, 60_000)

/** CV Fullstack — dữ liệu TỔNG HỢP (R8: không commit PII thật). */
function fullstackCv(): Profile {
  return ProfileSchema.parse({
    schemaVersion: 1,
    language: 'vi',
    basics: { name: 'Ứng viên A', headline: 'Fullstack Developer' },
    skills: [
      { name: 'JavaScript' },
      { name: 'TypeScript' },
      { name: 'ReactJS' },
      { name: 'Next.js' },
      { name: 'NodeJS' },
      { name: 'ExpressJS' },
      { name: 'MySQL' },
      { name: 'PostgreSQL' },
      { name: 'MongoDB' },
      { name: 'Docker' },
      { name: 'Git' },
      { name: 'Làm việc nhóm' },
    ],
    work: [
      {
        org: 'Công ty phần mềm A',
        role: 'Fullstack Developer',
        startDate: '2023',
        endDate: 'nay',
        highlights: [
          'Xây dựng RESTful API bằng NodeJS và ExpressJS, phục vụ 10.000 người dùng mỗi ngày',
          'Phát triển giao diện bằng ReactJS và Next.js, giảm thời gian tải trang 45%',
          'Tối ưu truy vấn PostgreSQL, rút ngắn thời gian phản hồi từ 800ms xuống 120ms',
        ],
      },
    ],
    education: [{ school: 'Đại học Bách Khoa', degree: 'Kỹ sư Công nghệ thông tin', highlights: [] }],
    languages: [{ name: 'Tiếng Anh', level: 'TOEIC 750' }],
  })
}

/** CV NGOÀI NGÀNH — dùng để kiểm chứng điểm phân biệt được hai loại. */
function nonTechCv(): Profile {
  return ProfileSchema.parse({
    schemaVersion: 1,
    language: 'vi',
    basics: { name: 'Ứng viên B', headline: 'Customer Service Specialist' },
    skills: [{ name: 'Chăm sóc khách hàng' }, { name: 'Giao tiếp' }],
    work: [
      {
        org: 'Công ty B',
        role: 'Customer Service',
        startDate: '2022',
        endDate: 'nay',
        highlights: [
          'Xử lý trung bình 60 yêu cầu khách hàng mỗi ngày qua điện thoại và email',
          'Đạt mức hài lòng 95% trong khảo sát quý',
        ],
      },
    ],
    education: [{ school: 'Đại học Ngoại thương', degree: 'Cử nhân Quản trị', highlights: [] }],
  })
}

async function parseJd(file: string): Promise<JDRequirements | null> {
  const md = await readFile(`${JD_DIR}/${file}`, 'utf8')
  const body = md.replace(/^---[\s\S]*?\n---\n/, '').trim()
  const res = await gw.run(parseJDTask, { rawText: body, language: 'vi' })
  return res.ok ? res.data : null
}

const run = (p: Profile, j: JDRequirements, emb = embedder) =>
  analyze({ profile: p, jd: j, taxonomy: taxonomy(), rubrics: rubrics(), embedder: emb })

describe('TC-42-01 — điểm phân biệt được CV hợp việc và không hợp', () => {
  it(
    'CV Fullstack ăn đứt CV ngoài ngành trên JD Fullstack',
    async () => {
      if (!up) {
        console.warn('⏭  model server không phản hồi')
        return
      }
      const jd = await parseJd('JD-01.md')
      if (!jd) return

      const good = await run(fullstackCv(), jd)
      const bad = await run(nonTechCv(), jd)

      console.log(`  Fullstack: ${good.match.overall} — ${JSON.stringify(good.match.breakdown)}`)
      console.log(`  Ngoài ngành: ${bad.match.overall} — ${JSON.stringify(bad.match.breakdown)}`)

      expect(good.match.overall).toBeGreaterThan(bad.match.overall)
      // Khoảng cách phải RÕ RỆT. Sát nhau nghĩa là điểm không nói lên điều gì.
      expect(good.match.overall - bad.match.overall).toBeGreaterThanOrEqual(20)
    },
    300_000,
  )

  it(
    'thanh `skills` của CV ngoài ngành phải gần 0',
    async () => {
      if (!up) return
      const jd = await parseJd('JD-01.md')
      if (!jd) return
      const bad = await run(nonTechCv(), jd)
      expect(bad.match.breakdown.skills).toBeLessThan(20)
    },
    300_000,
  )
})

describe('TC-42-02 — bằng chứng', () => {
  it(
    'mọi khớp có bằng chứng trỏ về CV; mọi thiếu KHÔNG có bằng chứng',
    async () => {
      if (!up) return
      const jd = await parseJd('JD-01.md')
      if (!jd) return
      const { match } = await run(fullstackCv(), jd)

      expect(match.matched.length, 'CV Fullstack không khớp yêu cầu nào').toBeGreaterThan(0)
      for (const m of match.matched) {
        expect(m.evidence.length, `"${m.requirement}" khớp mà không có bằng chứng`).toBeGreaterThan(0)
        for (const e of m.evidence) expect(e.path).toMatch(/^\//)
      }
    },
    300_000,
  )
})

describe('TC-42-03 — suy giảm khi embedder chết', () => {
  it(
    'vẫn ra điểm, gắn cờ degraded, và điểm KHÔNG lệch quá xa',
    async () => {
      if (!up) return
      const jd = await parseJd('JD-01.md')
      if (!jd) return

      const withEmb = await run(fullstackCv(), jd)
      const without = await run(fullstackCv(), jd, null)

      expect(without.match.degraded).toBe(true)
      expect(without.match.overall).toBeGreaterThan(0)

      // Mất lớp ngữ nghĩa làm điểm thấp đi, nhưng không được sụp đổ — nếu lệch
      // quá nhiều thì user thấy điểm nhảy loạn tuỳ lúc embedder sống hay chết
      const delta = Math.abs(withEmb.match.overall - without.match.overall)
      console.log(`  có embedder ${withEmb.match.overall} · không ${without.match.overall} · lệch ${delta}`)
      expect(delta).toBeLessThanOrEqual(25)
    },
    300_000,
  )
})

describe('TC-42-04 — deterministic trên dữ liệu thật', () => {
  it(
    'chạy ba lần cùng CV + cùng JD → cùng điểm',
    async () => {
      if (!up) return
      const jd = await parseJd('JD-01.md')
      if (!jd) return

      const cv = fullstackCv()
      const scores: number[] = []
      for (let i = 0; i < 3; i++) scores.push((await run(cv, jd)).match.overall)

      expect(new Set(scores).size, `điểm trôi: ${scores.join(', ')}`).toBe(1)
    },
    300_000,
  )
})

describe('TC-42-05 — mọi JD thật đều chấm được', () => {
  it(
    'không JD nào làm sập, không JD nào cho điểm vô nghĩa',
    async () => {
      if (!up) return
      const cv = fullstackCv()
      const rows: string[] = []

      for (const f of ['JD-01.md', 'JD-02.md', 'JD-03.md', 'JD-04.md', 'JD-05.md']) {
        const jd = await parseJd(f)
        if (!jd) continue
        const { match } = await run(cv, jd)

        expect(match.overall).toBeGreaterThanOrEqual(0)
        expect(match.overall).toBeLessThanOrEqual(100)
        // Mọi khoảng trống phải có id duy nhất — trùng id thì lời khuyên của
        // gap này ghi đè gap kia
        const ids = match.gaps.map((g) => g.id)
        expect(new Set(ids).size, `${f}: trùng gapId`).toBe(ids.length)

        rows.push(
          `  ${f} · ${match.overall}đ · skills ${match.breakdown.skills}` +
            ` · thiếu ${match.gaps.length}`,
        )
      }
      for (const r of rows) console.log(r)
    },
    600_000,
  )
})
