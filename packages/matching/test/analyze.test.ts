import { describe, it, expect, beforeAll } from 'vitest'
import { ProfileSchema, type JDRequirements, type Profile } from '@hr/schema'
import { analyze, estimateYears } from '../src/analyze.js'
import { taxonomy, type SkillTaxonomy } from '../src/taxonomy.js'
import { rubrics } from '../src/kb-load.js'
import type { Rubric } from '../src/rubric.js'
import type { EmbedFn } from '../src/semantic.js'

/**
 * Test lớp ghép ba tầng — TDD §8.2.
 *
 * Trọng tâm: NĂM THANH trong báo cáo phải đo đúng thứ chúng ghi tên. Bản đầu
 * nhét ba lớp vào năm ô nên `experience` hiện điểm ngữ nghĩa và `education`
 * hiện điểm kinh nghiệm — giao diện vẫn vẽ đủ năm thanh và nói dối ở hai thanh.
 */

let tax: SkillTaxonomy
let kb: Rubric[]
beforeAll(() => {
  tax = taxonomy()
  kb = rubrics()
})

function profile(over: Partial<Profile> = {}): Profile {
  return ProfileSchema.parse({
    schemaVersion: 1,
    language: 'vi',
    basics: { name: 'Nguyễn Văn A' },
    ...over,
  })
}

function jd(over: Partial<JDRequirements> = {}): JDRequirements {
  return {
    title: 'Backend Developer',
    language: 'vi',
    roleFamily: 'backend_developer',
    seniority: 'junior',
    yearsRequired: null,
    hardSkills: [],
    softSkills: [],
    responsibilities: [],
    atsKeywords: [],
    niceToHave: [],
    ...over,
  } as JDRequirements
}

const run = (p: Profile, j: JDRequirements, embedder: EmbedFn | null = null) =>
  analyze({ profile: p, jd: j, taxonomy: tax, rubrics: kb, embedder })

describe('estimateYears', () => {
  it('đọc được nhiều định dạng thời gian', () => {
    const p = profile({
      work: [{ org: 'A', role: 'Dev', startDate: '6/2021', endDate: '12/2023', highlights: [] }],
    })
    expect(estimateYears(p)).toBe(3) // 2021, 2022, 2023
  })

  it('"nay"/"present" tính tới năm hiện tại', () => {
    const y = new Date().getFullYear()
    const p = profile({
      work: [{ org: 'A', role: 'Dev', startDate: `1/${y - 1}`, endDate: 'nay', highlights: [] }],
    })
    expect(estimateYears(p)).toBe(2)
  })

  it('hai công việc CÙNG LÚC không cho gấp đôi kinh nghiệm', () => {
    const p = profile({
      work: [
        { org: 'A', role: 'Dev', startDate: '2022', endDate: '2023', highlights: [] },
        { org: 'B', role: 'Freelance', startDate: '2022', endDate: '2023', highlights: [] },
      ],
    })
    expect(estimateYears(p)).toBe(2)
  })

  it('thiếu mốc thời gian → bỏ qua, không đoán', () => {
    expect(estimateYears(profile({ work: [{ org: 'A', role: 'Dev', highlights: [] }] }))).toBe(0)
  })
})

describe('breakdown — mỗi thanh đo đúng tên của nó', () => {
  it('`skills` đo kỹ năng cứng, KHÔNG phải điểm lớp ngữ nghĩa', async () => {
    const p = profile({ skills: [{ name: 'React' }, { name: 'NodeJS' }] })
    const { match } = await run(p, jd({ hardSkills: ['React', 'NodeJS', 'Docker'] }))
    expect(match.breakdown.skills).toBe(67) // 2/3
  })

  it('`experience` đo SỐ NĂM khi JD có yêu cầu', async () => {
    const p = profile({
      work: [{ org: 'A', role: 'Dev', startDate: '2022', endDate: '2023', highlights: [] }],
    })
    // JD đòi 4 năm, CV có 2 → 50
    const { match } = await run(p, jd({ yearsRequired: 4 }))
    expect(match.breakdown.experience).toBe(50)
  })

  it('`experience` không vượt 100 khi thừa kinh nghiệm', async () => {
    const p = profile({
      work: [{ org: 'A', role: 'Dev', startDate: '2015', endDate: 'nay', highlights: [] }],
    })
    const { match } = await run(p, jd({ yearsRequired: 2 }))
    expect(match.breakdown.experience).toBe(100)
  })

  it('`education` đo HỌC VẤN, không phải kinh nghiệm', async () => {
    const withEdu = profile({ education: [{ school: 'ĐH X', degree: 'Kỹ sư', highlights: [] }] })
    const without = profile({ work: [{ org: 'A', role: 'Dev', highlights: [] }] })

    expect((await run(withEdu, jd())).match.breakdown.education).toBe(100)
    // Có kinh nghiệm nhưng KHÔNG có học vấn → thanh học vấn phải là 0
    expect((await run(without, jd())).match.breakdown.education).toBe(0)
  })

  it('`keywords` đo độ phủ ATS', async () => {
    const p = profile({ work: [{ org: 'A', role: 'Dev', highlights: ['Xây dựng RESTful API'] }] })
    const { match } = await run(p, jd({ atsKeywords: ['RESTful API', 'Kubernetes'] }))
    expect(match.breakdown.keywords).toBe(50)
  })

  it('mọi thanh nằm trong 0..100', async () => {
    const { match } = await run(profile(), jd({ hardSkills: ['React'], yearsRequired: 3 }))
    for (const [k, v] of Object.entries(match.breakdown)) {
      expect(v, k).toBeGreaterThanOrEqual(0)
      expect(v, k).toBeLessThanOrEqual(100)
    }
  })
})

describe('lớp ngữ nghĩa CỨU yêu cầu khỏi bị xếp thiếu', () => {
  const REQ = 'tối ưu hiệu năng'
  const cv = profile({
    work: [
      {
        org: 'A',
        role: 'Dev',
        highlights: ['Giảm thời gian phản hồi từ 800ms xuống 120ms'],
      },
    ],
  })

  it('không có embedder → xếp THIẾU', async () => {
    const { match } = await run(cv, jd({ hardSkills: [REQ] }))
    expect(match.gaps.find((g) => g.requirement === REQ)?.reason).toBe('missing')
    expect(match.matched).toHaveLength(0)
  })

  it('có embedder thấy được → chuyển thành KHỚP NGẦM, không phải thiếu hẳn', async () => {
    const embedder: EmbedFn = {
      embedBatch: async (texts) =>
        texts.map((t) => (t === REQ ? [1, 0, 0] : [0.98, 0.2, 0])),
    }
    const { match } = await run(cv, jd({ hardSkills: [REQ] }), embedder)

    expect(match.matched.map((m) => m.requirement)).toContain(REQ)
    // Vẫn là khoảng trống, nhưng dạng `implicit`: CV thể hiện được mà KHÔNG
    // dùng đúng từ JD dùng → hệ thống lọc tự động vẫn bỏ sót
    const g = match.gaps.find((x) => x.requirement === REQ)
    expect(g?.reason).toBe('implicit')
    expect(g?.severity).toBe('medium')
  })

  it('yêu cầu được cứu cũng nâng thanh `skills`', async () => {
    const embedder: EmbedFn = {
      embedBatch: async (texts) => texts.map((t) => (t === REQ ? [1, 0, 0] : [0.98, 0.2, 0])),
    }
    const withEmb = await run(cv, jd({ hardSkills: [REQ] }), embedder)
    const without = await run(cv, jd({ hardSkills: [REQ] }))
    expect(withEmb.match.breakdown.skills).toBeGreaterThan(without.match.breakdown.skills)
  })
})

describe('suy giảm', () => {
  it('embedder chết → vẫn ra điểm, `degraded` bật kèm lý do', async () => {
    const broken: EmbedFn = {
      embedBatch: async () => {
        throw new Error('ECONNREFUSED')
      },
    }
    const p = profile({
      skills: [{ name: 'React' }],
      work: [
        {
          org: 'Công ty A',
          role: 'Developer',
          highlights: ['Xây dựng giao diện quản trị bằng ReactJS cho 2.000 người dùng nội bộ'],
        },
      ],
    })
    const { match } = await run(p, jd({ hardSkills: ['React'] }), broken)

    expect(match.overall).toBeGreaterThan(0)
    expect(match.degraded).toBe(true)
    expect(match.degradedReason).toBeTruthy()
  })

  it('CV không có đoạn nào đủ dài → KHÔNG phải degraded', async () => {
    // Khác nhau: "đo không được" (embedder chết) vs "không có gì để đo".
    // Gộp hai thứ lại sẽ hiện băng cảnh báo cho một CV hoàn toàn bình thường.
    const broken: EmbedFn = {
      embedBatch: async () => {
        throw new Error('ECONNREFUSED')
      },
    }
    const { match } = await run(
      profile({ skills: [{ name: 'React' }] }),
      jd({ hardSkills: ['React'] }),
      broken,
    )
    expect(match.degraded).toBe(false)
  })
})

describe('khoảng trống', () => {
  it('tiêu chí rubric không đạt cũng là khoảng trống, kèm lời khuyên SẴN từ KB', async () => {
    const { match } = await run(profile(), jd())
    const rubricGaps = match.gaps.filter((g) => g.id.startsWith('rubric:'))

    expect(rubricGaps.length).toBeGreaterThan(0)
    // Lời khuyên rubric lấy thẳng từ KB — không cần gọi model
    expect(rubricGaps.some((g) => g.advice !== null)).toBe(true)
  })

  it('mọi khớp đều có bằng chứng', async () => {
    const p = profile({ skills: [{ name: 'React' }] })
    const { match } = await run(p, jd({ hardSkills: ['React'] }))
    for (const m of match.matched) expect(m.evidence.length).toBeGreaterThan(0)
  })

  it('deterministic', async () => {
    const p = profile({ skills: [{ name: 'React' }], work: [{ org: 'A', role: 'Dev', highlights: ['x'] }] })
    const j = jd({ hardSkills: ['React', 'Vue'], atsKeywords: ['API'] })
    const runs = await Promise.all([run(p, j), run(p, j), run(p, j)])
    expect(new Set(runs.map((r) => r.match.overall)).size).toBe(1)
  })
})
