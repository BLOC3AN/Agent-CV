import { describe, it, expect, beforeAll } from 'vitest'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Gateway, parseJDTask } from '@hr/ai'
import { ProfileSchema, type JDRequirements, type Profile } from '@hr/schema'
import { taxonomy, type SkillTaxonomy } from '../src/taxonomy.js'
import { scoreKeyword } from '../src/keyword.js'

/**
 * Đo lớp khớp từ khoá trên JD THẬT — TDD §8.2.
 *
 * Test đơn vị chứng minh logic đúng với dữ liệu tự nghĩ ra. Test này chứng minh
 * nó còn đúng với JD người thật viết: viết tắt lạ, trộn Việt-Anh trong một câu,
 * yêu cầu diễn đạt lòng vòng. Mọi lỗi thật của dự án này đều lộ ra ở bước đo
 * dữ liệu thật, không phải ở test đơn vị.
 *
 *   npm run test:int
 */

const JD_DIR = resolve(import.meta.dirname, '../../../eval/jd')

let gw: Gateway
let tax: SkillTaxonomy
let modelUp = false
let jdFiles: string[] = []

beforeAll(async () => {
  gw = new Gateway()
  tax = taxonomy()
  modelUp = await gw
    .health()
    .then((h) => h.models['local.reasoner'] === true)
    .catch(() => false)
  jdFiles = (await readdir(JD_DIR).catch(() => [])).filter((f) => f.endsWith('.md')).sort()
}, 60_000)

/** CV mẫu Fullstack — dữ liệu TỔNG HỢP, không phải CV thật (R8). */
function fullstackCv(): Profile {
  return ProfileSchema.parse({
    schemaVersion: 1,
    language: 'vi',
    basics: { name: 'Ứng viên mẫu', headline: 'Fullstack Developer' },
    skills: [
      { name: 'JavaScript' },
      { name: 'TypeScript' },
      { name: 'ReactJS' },
      { name: 'Next.js' },
      { name: 'NodeJS' },
      { name: 'ExpressJS' },
      { name: 'MySQL' },
      { name: 'PostgreSQL' },
      { name: 'Docker' },
      { name: 'Git' },
      { name: 'Làm việc nhóm' },
      { name: 'Giao tiếp' },
      { name: 'Giải quyết vấn đề' },
    ],
    work: [
      {
        org: 'Công ty phần mềm A',
        role: 'Fullstack Developer',
        highlights: [
          'Xây dựng RESTful API bằng NodeJS và ExpressJS, phục vụ 10.000 người dùng',
          'Phát triển giao diện bằng ReactJS và Next.js, tối ưu thời gian tải trang',
          'Tối ưu truy vấn PostgreSQL, giảm thời gian phản hồi từ 800ms xuống 120ms',
        ],
      },
    ],
    education: [{ school: 'Đại học Bách Khoa', degree: 'Kỹ sư CNTT', highlights: [] }],
    languages: [{ name: 'Tiếng Anh', level: 'TOEIC 750' }],
  })
}

async function parseJd(file: string): Promise<JDRequirements | null> {
  const md = await readFile(`${JD_DIR}/${file}`, 'utf8')
  // Bỏ frontmatter YAML — nó chứa đáp án mong đợi, đưa vào là hỏi bài
  const body = md.replace(/^---[\s\S]*?\n---\n/, '').trim()
  const res = await gw.run(parseJDTask, { rawText: body, language: 'vi' })
  return res.ok ? res.data : null
}

describe('parse_jd trên JD thật', () => {
  it(
    'mọi JD đều trích được yêu cầu — JD rỗng nghĩa là điểm vô nghĩa',
    async () => {
      if (!modelUp || jdFiles.length === 0) {
        console.warn('⏭  thiếu model server hoặc file JD')
        return
      }

      const empty: string[] = []
      for (const f of jdFiles) {
        const jd = await parseJd(f)
        if (!jd) {
          empty.push(`${f}: parse_jd thất bại`)
          continue
        }
        // JD-05 là JD mơ hồ có chủ đích trong bộ eval — vẫn phải có từ khoá ATS
        const total = jd.hardSkills.length + jd.softSkills.length + jd.atsKeywords.length
        if (total === 0) empty.push(`${f}: không trích được yêu cầu nào`)
      }
      expect(empty, empty.join('\n')).toEqual([])
    },
    300_000,
  )
})

describe('điểm khớp trên JD thật', () => {
  it(
    'CV Fullstack đạt điểm CAO với JD Fullstack và THẤP hơn với JD ngoài ngành',
    async () => {
      if (!modelUp || jdFiles.length === 0) return

      const scores: {
        file: string
        title: string
        score: number
        parts: { hard: number | null; soft: number | null; ats: number | null }
        counts: string
        missing: string[]
      }[] = []
      const cv = fullstackCv()

      for (const f of jdFiles) {
        const jd = await parseJd(f)
        if (!jd) continue
        const r = scoreKeyword(cv, jd, tax)

        expect(r.noRequirements, `${f}: JD rỗng thì điểm không có ý nghĩa`).toBe(false)
        expect(r.score).toBeGreaterThanOrEqual(0)
        expect(r.score).toBeLessThanOrEqual(100)

        scores.push({
          file: f,
          title: jd.title,
          score: r.score,
          parts: r.parts,
          counts:
            `hard ${r.hardSkills.filter((m) => m.matched).length}/${r.hardSkills.length}` +
            ` soft ${r.softSkills.filter((m) => m.matched).length}/${r.softSkills.length}` +
            ` ats ${r.matchedAtsKeywords.length}/${r.matchedAtsKeywords.length + r.missingAtsKeywords.length}`,
          missing: r.hardSkills.filter((m) => !m.matched).map((m) => m.requirement),
        })
      }

      for (const s of scores) {
        console.log(
          `  ${s.file} · ${s.score}đ (hard ${s.parts.hard ?? '—'} soft ${s.parts.soft ?? '—'} ats ${s.parts.ats ?? '—'})` +
            ` · ${s.counts} · thiếu: ${s.missing.join(', ') || '—'}`,
        )
      }

      // KHÔNG khẳng định một ngưỡng tuyệt đối.
      //
      // Từng viết `expect(jd01.score).toBeGreaterThan(50)` — con số 50 hoàn
      // toàn bịa ra. Đo thực tế cho 41, và phân tích thành phần cho thấy 41 là
      // ĐÚNG: CV mẫu thật sự thiếu 4/11 kỹ năng cứng và 8/9 từ khoá ATS mà
      // JD-01 đòi. Chỉnh ngưỡng xuống cho test xanh chỉ là uốn test theo code;
      // chỉnh fixture cho tới khi vượt ngưỡng còn tệ hơn.
      //
      // Thứ CÓ ý nghĩa là THỨ TỰ TƯƠNG ĐỐI: cùng một CV, JD đúng ngành phải
      // được điểm cao hơn JD trái ngành. Đó là tính chất một bộ khớp hoạt động
      // được phải có, và nó không phụ thuộc vào việc hiệu chỉnh trọng số.
      const jd01 = scores.find((s) => s.file.startsWith('JD-01')) // Fullstack Node/Next
      const jd03 = scores.find((s) => s.file.startsWith('JD-03')) // Backend Java/Spring
      if (jd01 && jd03) {
        expect(
          jd01.score,
          `CV Fullstack phải hợp JD Fullstack (${jd01.score}) hơn JD Java (${jd03.score})`,
        ).toBeGreaterThan(jd03.score)
      }

      // Sàn tối thiểu: CV khớp quá nửa kỹ năng cứng thì lớp `hard` không được
      // dưới 50. Đây là tính chất của phép tính, không phải ngưỡng cảm tính.
      for (const s of scores) {
        const [got, total] = /hard (\d+)\/(\d+)/.exec(s.counts)!.slice(1).map(Number)
        if (total! > 0 && got! / total! > 0.5) {
          expect(s.parts.hard, `${s.file}: khớp ${got}/${total} mà hard = ${s.parts.hard}`)
            .toBeGreaterThanOrEqual(50)
        }
        // Lớp rỗng phải là `null` (bị bỏ qua), không phải 100
        if (total === 0) expect(s.parts.hard, `${s.file}: lớp hard rỗng`).toBeNull()
      }

      // Không JD nào được 100 với một CV mẫu: JD thật luôn có yêu cầu riêng
      expect(scores.filter((s) => s.score === 100), 'điểm tuyệt đối là dấu hiệu khớp quá dễ').toEqual([])
    },
    300_000,
  )

  it(
    'mọi khớp đều có bằng chứng, mọi thiếu đều KHÔNG có bằng chứng',
    async () => {
      if (!modelUp || jdFiles.length === 0) return

      const jd = await parseJd(jdFiles[0]!)
      if (!jd) return
      const r = scoreKeyword(fullstackCv(), jd, tax)

      for (const m of [...r.hardSkills, ...r.softSkills]) {
        if (m.matched) {
          expect(m.evidence.length, `"${m.requirement}" khớp mà không có bằng chứng`).toBeGreaterThan(0)
        } else {
          expect(m.evidence, `"${m.requirement}" không khớp mà vẫn có bằng chứng`).toEqual([])
        }
      }
    },
    300_000,
  )
})

describe('chống chèn lệnh qua JD', () => {
  it(
    'JD chứa câu lệnh không làm đổi hành vi chấm điểm',
    async () => {
      if (!modelUp) return

      // JD-05 trong bộ eval cố tình chứa prompt injection. Điểm tính bằng CODE
      // nên dù model có bị dụ, con số vẫn do bằng chứng trong CV quyết định —
      // đây chính là lý do thực dụng của quyết định D3.
      const injected = await parseJd('JD-05.md').catch(() => null)
      if (!injected) return

      const cv = fullstackCv()
      const r = scoreKeyword(cv, injected, tax)

      // Không có yêu cầu nào khớp mà thiếu bằng chứng trong CV
      for (const m of r.hardSkills.filter((x) => x.matched)) {
        expect(m.evidence.length, `"${m.requirement}" khớp mà không có bằng chứng`).toBeGreaterThan(0)
      }
      expect(r.score).toBeLessThanOrEqual(100)
    },
    300_000,
  )
})
