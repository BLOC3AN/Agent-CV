import { describe, it, expect, beforeAll } from 'vitest'
import { ProfileSchema, type Profile, type JDRequirements } from '@hr/schema'
import { taxonomy, type SkillTaxonomy } from '../src/taxonomy.js'
import { chunkProfile, scoreKeyword } from '../src/keyword.js'

/**
 * Test lớp khớp từ khoá — TDD §8.2 lớp 1, quyết định D3.
 *
 * Điểm tính bằng CODE nên phải deterministic và giải thích được. Test này là
 * nơi chứng minh điều đó: cùng đầu vào luôn ra cùng điểm, và mỗi lần khớp đều
 * chỉ ra được chỗ nào trong CV.
 */

let tax: SkillTaxonomy
beforeAll(() => {
  tax = taxonomy()
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
    seniority: 'fresher',
    yearsRequired: null,
    hardSkills: [],
    softSkills: [],
    responsibilities: [],
    atsKeywords: [],
    niceToHave: [],
    ...over,
  } as JDRequirements
}

describe('chunkProfile', () => {
  it('mỗi đoạn có JSON Pointer trỏ về đúng chỗ', () => {
    // Báo cáo phải nói "khớp React ← Dự án 1", không phải "đâu đó trong CV".
    // Không có địa chỉ thì user không kiểm chứng được và nút "Sửa giúp tôi"
    // không biết sửa chỗ nào.
    const chunks = chunkProfile(
      profile({
        work: [{ org: 'Cty X', role: 'Backend Dev', highlights: ['Xây API bằng NodeJS'] }],
        projects: [{ name: 'Shop', tech: ['React'], highlights: [] }],
      }),
    )
    const paths = chunks.map((c) => c.path)
    expect(paths).toContain('/work/0/role')
    expect(paths).toContain('/work/0/highlights/0')
    expect(paths).toContain('/projects/0/tech')
  })

  it('bỏ qua field rỗng — không sinh đoạn trống', () => {
    expect(chunkProfile(profile()).every((c) => c.text.trim())).toBe(true)
  })
})

describe('scoreKeyword — khớp cơ bản', () => {
  const cv = profile({
    skills: [{ name: 'ReactJS' }, { name: 'Node.js' }, { name: 'PostgreSQL' }],
    work: [
      {
        org: 'Cty X',
        role: 'Backend Developer',
        highlights: ['Xây dựng RESTful API bằng NodeJS, tối ưu truy vấn PostgreSQL'],
      },
    ],
  })

  it('JD hỏi đúng thứ CV có → khớp hết, 100 điểm kỹ năng cứng', () => {
    const r = scoreKeyword(cv, jd({ hardSkills: ['React', 'Node.js', 'PostgreSQL'] }), tax)
    expect(r.hardSkills.every((m) => m.matched)).toBe(true)
    expect(r.score).toBe(100)
  })

  it('mỗi lần khớp đều chỉ ra được chỗ trong CV', () => {
    const r = scoreKeyword(cv, jd({ hardSkills: ['PostgreSQL'] }), tax)
    const m = r.hardSkills[0]!
    expect(m.evidence.length).toBeGreaterThan(0)
    expect(m.evidence[0]!.path).toMatch(/^\//)
    expect(m.evidence[0]!.excerpt).toBeTruthy()
  })

  it('không khớp thì evidence RỖNG — không bịa bằng chứng', () => {
    const r = scoreKeyword(cv, jd({ hardSkills: ['Kubernetes'] }), tax)
    expect(r.hardSkills[0]).toMatchObject({ matched: false, evidence: [] })
  })

  it('cách viết khác nhau vẫn khớp — ReactJS ≡ React.js ≡ React', () => {
    for (const written of ['React', 'ReactJS', 'React.js', 'react js']) {
      const r = scoreKeyword(cv, jd({ hardSkills: [written] }), tax)
      expect(r.hardSkills[0]!.matched, written).toBe(true)
    }
  })

  it('deterministic — chạy nhiều lần cùng kết quả', () => {
    const j = jd({ hardSkills: ['React', 'Docker'], softSkills: ['teamwork'], atsKeywords: ['API'] })
    const runs = Array.from({ length: 5 }, () => scoreKeyword(cv, j, tax).score)
    expect(new Set(runs).size).toBe(1)
  })
})

describe('khớp qua kỹ năng con', () => {
  it('JD cần React, CV ghi Next.js → vẫn khớp', () => {
    // Biết Next.js nghĩa là biết React. Không xử lý thì báo cáo nói "thiếu
    // React" với một ứng viên rõ ràng biết React.
    const cv = profile({ skills: [{ name: 'Next.js' }] })
    const r = scoreKeyword(cv, jd({ hardSkills: ['React'] }), tax)

    expect(r.hardSkills[0]!.matched).toBe(true)
    expect(r.hardSkills[0]!.viaDescendant).toBe('nextjs')
    expect(r.hardSkills[0]!.evidence.length).toBeGreaterThan(0)
  })

  it('chiều ngược lại KHÔNG khớp — biết React không có nghĩa là biết Next.js', () => {
    const cv = profile({ skills: [{ name: 'React' }] })
    const r = scoreKeyword(cv, jd({ hardSkills: ['Next.js'] }), tax)
    expect(r.hardSkills[0]!.matched).toBe(false)
  })
})

describe('không thổi phồng điểm', () => {
  it('CV JavaScript KHÔNG khớp JD tuyển Java', () => {
    // Lỗi kinh điển của `includes`: "java" nằm trong "javascript"
    const cv = profile({ skills: [{ name: 'JavaScript' }, { name: 'TypeScript' }] })
    const r = scoreKeyword(cv, jd({ hardSkills: ['Java'] }), tax)
    expect(r.hardSkills[0]!.matched).toBe(false)
  })

  it('CV biết C++ KHÔNG được chấm là biết C', () => {
    const cv = profile({ skills: [{ name: 'C++' }] })
    const r = scoreKeyword(cv, jd({ hardSkills: ['C'] }), tax)
    expect(r.hardSkills[0]!.matched).toBe(false)
  })

  it('kỹ năng CV có mà JD không hỏi không làm tăng điểm', () => {
    const rich = profile({
      skills: Array.from({ length: 40 }, (_, i) => ({ name: ['React', 'Vue', 'Docker', 'AWS'][i % 4]! })),
    })
    const poor = profile({ skills: [{ name: 'React' }] })
    const j = jd({ hardSkills: ['React', 'Kubernetes'] })

    expect(scoreKeyword(rich, j, tax).score).toBe(scoreKeyword(poor, j, tax).score)
  })

  it('nhưng vẫn liệt kê ra để tư vấn', () => {
    const cv = profile({ skills: [{ name: 'React' }, { name: 'Docker' }] })
    const r = scoreKeyword(cv, jd({ hardSkills: ['React'] }), tax)
    expect(r.extraSkills.map((s) => s.canonical)).toContain('docker')
  })
})

describe('trọng số kỹ năng cứng và mềm', () => {
  it('thiếu kỹ năng CỨNG mất nhiều điểm hơn thiếu kỹ năng MỀM', () => {
    const j = { hardSkills: ['React', 'Docker'], softSkills: ['teamwork', 'communication'] }

    const noHard = scoreKeyword(
      profile({ skills: [{ name: 'teamwork' }, { name: 'communication' }] }),
      jd(j),
      tax,
    )
    const noSoft = scoreKeyword(
      profile({ skills: [{ name: 'React' }, { name: 'Docker' }] }),
      jd(j),
      tax,
    )

    expect(noSoft.score).toBeGreaterThan(noHard.score)
  })

  it('JD không đòi gì → gắn cờ, KHÔNG lặng lẽ cho 100 điểm', () => {
    // Một JD parse HỎNG và một JD thật sự không đòi kỹ năng nào cho ra cùng
    // đầu vào. Chấm 100 thì lỗi parse biến thành "hồ sơ hoàn hảo".
    const r = scoreKeyword(profile(), jd(), tax)
    expect(r.noRequirements).toBe(true)
    expect(r.score).toBe(0)
    expect(r.parts).toEqual({ hard: null, soft: null, ats: null })
  })

  it('lớp RỖNG bị bỏ qua, không được cho 100 điểm', () => {
    // Đo trên JD-04 thật (JD mơ hồ có chủ đích, không nêu kỹ năng cứng nào):
    // cách cũ cho lớp hard rỗng 100 điểm và kéo tổng lên 83 — một con số vô
    // nghĩa nhưng trông đáng tin.
    const cv = profile({ skills: [{ name: 'React' }] })
    const r = scoreKeyword(cv, jd({ softSkills: ['Teamwork'] }), tax)

    expect(r.parts.hard, 'lớp hard rỗng phải là null').toBeNull()
    expect(r.parts.ats).toBeNull()
    expect(r.noHardRequirements).toBe(true)
    // Điểm chỉ phản ánh lớp DUY NHẤT đo được: soft (0/1 → 0)
    expect(r.score).toBe(0)
  })

  it('JD chỉ có kỹ năng cứng: điểm bằng đúng lớp đó', () => {
    const cv = profile({ skills: [{ name: 'React' }] })
    const r = scoreKeyword(cv, jd({ hardSkills: ['React', 'Vue'] }), tax)
    expect(r.parts.hard).toBe(50)
    expect(r.score).toBe(50)
  })

  it('JD có yêu cầu thì cờ tắt', () => {
    const r = scoreKeyword(profile(), jd({ hardSkills: ['React'] }), tax)
    expect(r.noRequirements).toBe(false)
  })

  it('chỉ có atsKeywords cũng tính là có yêu cầu', () => {
    expect(scoreKeyword(profile(), jd({ atsKeywords: ['React'] }), tax).noRequirements).toBe(false)
  })
})

describe('từ khoá ATS', () => {
  const cv = profile({
    work: [
      { org: 'X', role: 'Dev', highlights: ['Xây dựng RESTful API và viết unit test'] },
    ],
  })

  it('so khớp NGUYÊN VĂN của JD — ATS không biết đồng nghĩa', () => {
    const r = scoreKeyword(cv, jd({ atsKeywords: ['RESTful API', 'unit test', 'Kubernetes'] }), tax)
    expect(r.matchedAtsKeywords).toEqual(['RESTful API', 'unit test'])
    expect(r.missingAtsKeywords).toEqual(['Kubernetes'])
  })

  it('từ khoá thiếu giữ nguyên cách viết của JD để user copy vào CV', () => {
    const r = scoreKeyword(cv, jd({ atsKeywords: ['CI/CD Pipeline'] }), tax)
    expect(r.missingAtsKeywords[0]).toBe('CI/CD Pipeline')
  })
})

describe('yêu cầu ngoài phân loại', () => {
  it('vẫn khớp bằng chuỗi — phân loại không bao giờ đầy đủ', () => {
    const cv = profile({
      work: [{ org: 'X', role: 'Dev', highlights: ['Triển khai hệ thống Odoo ERP cho nhà máy'] }],
    })
    const r = scoreKeyword(cv, jd({ hardSkills: ['Odoo'] }), tax)

    expect(r.hardSkills[0]!.matched).toBe(true)
    expect(r.hardSkills[0]!.canonical).toBeNull()
  })

  it('khớp chuỗi vẫn theo ranh giới từ, không khớp một phần', () => {
    const cv = profile({ work: [{ org: 'X', role: 'Dev', highlights: ['Odoosomething'] }] })
    expect(scoreKeyword(cv, jd({ hardSkills: ['Odoo'] }), tax).hardSkills[0]!.matched).toBe(false)
  })
})

describe('song ngữ — TDD §9.2', () => {
  it('JD tiếng Anh khớp CV tiếng Việt', () => {
    const cv = profile({
      skills: [{ name: 'Làm việc nhóm' }],
      work: [{ org: 'X', role: 'Dev', highlights: ['Kiểm thử tự động với Jest'] }],
    })
    const r = scoreKeyword(cv, jd({ hardSkills: ['Unit Testing'], softSkills: ['Teamwork'] }), tax)

    expect(r.hardSkills[0]!.matched, 'unit test').toBe(true)
    expect(r.softSkills[0]!.matched, 'teamwork').toBe(true)
  })

  it('CV gõ KHÔNG DẤU vẫn khớp', () => {
    const cv = profile({ skills: [{ name: 'lam viec nhom' }, { name: 'giao tiep' }] })
    const r = scoreKeyword(cv, jd({ softSkills: ['Làm việc nhóm', 'Giao tiếp'] }), tax)
    expect(r.softSkills.every((m) => m.matched)).toBe(true)
  })

  it('IELTS được tính là tiếng Anh', () => {
    const cv = profile({ certifications: [{ name: 'IELTS 7.0' }] })
    expect(scoreKeyword(cv, jd({ softSkills: ['Tiếng Anh'] }), tax).softSkills[0]!.matched).toBe(true)
  })
})

describe('điểm nằm trong 0..100', () => {
  const cases: [string, Profile, JDRequirements][] = [
    ['CV rỗng, JD nhiều yêu cầu', profile(), jd({ hardSkills: ['React', 'Vue', 'Docker'] })],
    ['CV đầy đủ, JD rỗng', profile({ skills: [{ name: 'React' }] }), jd()],
    ['cả hai rỗng', profile(), jd()],
  ]

  for (const [name, cv, j] of cases) {
    it(name, () => {
      const s = scoreKeyword(cv, j, tax).score
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThanOrEqual(100)
      expect(Number.isInteger(s)).toBe(true)
    })
  }
})
