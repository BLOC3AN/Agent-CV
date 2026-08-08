import { describe, it, expect, beforeAll } from 'vitest'
import { SkillTaxonomy, taxonomy, canonicalizeSkills } from '../src/taxonomy.js'
import { normalize, tokenize, containsPhrase, deaccent } from '../src/normalize.js'

/**
 * Test phân loại kỹ năng — TDD §9.2.
 *
 * Đây là nền của toàn bộ điểm đối chiếu. Sai ở đây thì báo cáo nói "bạn thiếu
 * React" trên một CV đầy React, và mọi lời khuyên phía sau đều lệch.
 */

let tax: SkillTaxonomy

beforeAll(() => {
  tax = taxonomy()
})

describe('normalize', () => {
  it('bỏ dấu tiếng Việt', () => {
    expect(deaccent('quản lý dự án')).toBe('quan ly du an')
    expect(deaccent('Đại học Bách Khoa')).toBe('Dai hoc Bach Khoa')
  })

  it('GIỮ ký tự mang nghĩa trong tên công nghệ', () => {
    // Bỏ hết dấu câu sẽ biến "C++" thành "c" — CV biết C++ bị chấm là biết C
    expect(normalize('C++')).toBe('c++')
    expect(normalize('C#')).toBe('c#')
    expect(normalize('Node.js')).toBe('node.js')
    expect(normalize('.NET')).toBe('.net')
  })

  it('gạch nối và gạch dưới quy về khoảng trắng', () => {
    expect(normalize('react-router')).toBe('react router')
    expect(normalize('unit_test')).toBe('unit test')
  })

  it('tokenize giữ nguyên token có ký tự đặc biệt', () => {
    expect(tokenize('Node.js và C++')).toEqual(['node.js', 'va', 'c++'])
  })
})

describe('containsPhrase — ranh giới từ', () => {
  it('KHÔNG khớp "java" bên trong "javascript"', () => {
    // Sai theo hướng nguy hiểm: nó THỔI PHỒNG điểm. CV toàn JavaScript sẽ
    // được chấm là biết Java, và JD tuyển Java khớp nhầm.
    expect(containsPhrase(' javascript typescript ', 'java')).toBe(false)
    expect(containsPhrase(' java spring boot ', 'java')).toBe(true)
  })

  it('khớp được token có + và #', () => {
    // `\b` của regex không dùng được: `+`/`#` không phải ký tự từ
    expect(containsPhrase(' thanh thao c++ va python ', 'c++')).toBe(true)
    expect(containsPhrase(' c# .net core ', 'c#')).toBe(true)
  })

  it('"c" không khớp bên trong "c++"', () => {
    expect(containsPhrase(' c++ ', 'c')).toBe(false)
  })

  it('khớp ở đầu và cuối chuỗi', () => {
    expect(containsPhrase('react', 'react')).toBe(true)
    expect(containsPhrase('biet react', 'react')).toBe(true)
  })

  it('cụm nhiều từ khớp đúng', () => {
    expect(containsPhrase(' dung spring boot cho backend ', 'spring boot')).toBe(true)
    expect(containsPhrase(' spring framework ', 'spring boot')).toBe(false)
  })
})

describe('canonicalize', () => {
  const cases: [string, string][] = [
    ['ReactJS', 'react'],
    ['React.js', 'react'],
    ['react js', 'react'],
    ['REACT', 'react'],
    ['Next.js 15', 'nextjs'],
    ['Vue 3 (Composition API)', 'vue'],
    ['NodeJS', 'nodejs'],
    ['Node.js', 'nodejs'],
    ['Spring Boot', 'spring'],
    ['PostgreSQL', 'postgresql'],
    ['Postgres', 'postgresql'],
    ['MySQL 8', 'mysql'],
    ['TypeScript', 'typescript'],
    ['C++', 'cpp'],
    ['C#', 'csharp'],
    ['.NET Core', 'dotnet'],
    ['k8s', 'kubernetes'],
    ['GitHub Actions', 'cicd'],
    ['RESTful API', 'rest_api'],
    ['Tiếng Anh', 'english'],
    ['tieng anh', 'english'],
    ['IELTS 7.0', 'english'],
    ['quản lý dự án'.replace('quản lý dự án', 'Agile/Scrum'), 'agile'],
  ]

  for (const [input, expected] of cases) {
    it(`"${input}" → ${expected}`, () => {
      expect(tax.canonicalize(input)?.canonical).toBe(expected)
    })
  }

  it('không nhận ra thì trả null, không đoán bừa', () => {
    expect(tax.canonicalize('Odoo ERP XYZ')).toBeNull()
    expect(tax.canonicalize('')).toBeNull()
  })

  it('Java và JavaScript là hai kỹ năng khác nhau', () => {
    expect(tax.canonicalize('Java')?.canonical).toBe('java')
    expect(tax.canonicalize('JavaScript')?.canonical).toBe('javascript')
  })
})

describe('extract — quét cả đoạn văn', () => {
  it('bắt được nhiều kỹ năng trong một câu', () => {
    const hits = tax.extract(
      'Xây dựng API bằng NodeJS và Express, dữ liệu lưu ở PostgreSQL, triển khai bằng Docker',
    )
    const found = hits.map((h) => h.canonical).sort()
    expect(found).toContain('nodejs')
    expect(found).toContain('express')
    expect(found).toContain('postgresql')
    expect(found).toContain('docker')
  })

  it('khớp cụm DÀI trước — "spring boot" không tách thành hai', () => {
    const hits = tax.extract('Dùng Spring Boot cho backend')
    expect(hits.map((h) => h.canonical)).toContain('spring')
    // Chỉ một kỹ năng, không nhân đôi
    expect(hits.filter((h) => h.canonical === 'spring')).toHaveLength(1)
  })

  it('không đếm trùng khi một kỹ năng xuất hiện nhiều lần', () => {
    const hits = tax.extract('React, React Hooks, ReactJS, react.js')
    expect(hits.filter((h) => h.canonical === 'react')).toHaveLength(1)
  })

  it('text tiếng Việt không dấu vẫn bắt được', () => {
    const hits = tax.extract('lam viec nhom tot, giao tiep hieu qua')
    const found = hits.map((h) => h.canonical)
    expect(found).toContain('teamwork')
    expect(found).toContain('communication')
  })

  it('đoạn không có kỹ năng nào trả mảng rỗng', () => {
    expect(tax.extract('Tôi thích uống cà phê buổi sáng')).toEqual([])
  })
})

describe('quan hệ cha con', () => {
  it('Next.js kế thừa React và JavaScript', () => {
    expect(tax.ancestors('nextjs')).toEqual(['react', 'javascript'])
  })

  it('TypeScript kế thừa JavaScript', () => {
    expect(tax.ancestors('typescript')).toEqual(['javascript'])
  })

  it('kỹ năng gốc không có tổ tiên', () => {
    expect(tax.ancestors('python')).toEqual([])
  })

  it('withAncestors mở rộng cả tập', () => {
    const s = tax.withAncestors(['nextjs', 'spring'])
    expect([...s].sort()).toEqual(['java', 'javascript', 'nextjs', 'react', 'spring'])
  })

  it('vòng lặp cha-con không làm treo', () => {
    const t = new SkillTaxonomy([
      { canonical: 'a', display: { vi: 'A', en: 'A' }, kind: 'tool', aliases: [], parent: 'b', weight: 1 },
      { canonical: 'b', display: { vi: 'B', en: 'B' }, kind: 'tool', aliases: [], parent: 'a', weight: 1 },
    ])
    expect(t.ancestors('a')).toEqual(['b'])
  })
})

describe('tính toàn vẹn của file phân loại', () => {
  it('đọc được và có đủ độ phủ cho ngành IT', () => {
    expect(tax.size).toBeGreaterThan(50)
  })

  it('không có canonical trùng', () => {
    const all = tax.all().map((e) => e.canonical)
    expect(new Set(all).size).toBe(all.length)
  })

  it('mọi `parent` đều trỏ tới kỹ năng CÓ THẬT', () => {
    // parent gõ sai sẽ làm `ancestors` im lặng trả thiếu, và JD tuyển React
    // không còn khớp với CV ghi Next.js — không có lỗi nào hiện ra
    const known = new Set(tax.all().map((e) => e.canonical))
    const bad = tax.all().filter((e) => e.parent && !known.has(e.parent))
    expect(bad.map((e) => `${e.canonical} → ${e.parent}`)).toEqual([])
  })

  it('kỹ năng mềm có trọng số THẤP hơn kỹ năng cứng', () => {
    // CV nào cũng ghi "teamwork". Cho ngang nhau là thưởng cho việc liệt kê
    // tính từ thay vì bằng chứng.
    const soft = tax.all().filter((e) => e.kind === 'soft' && e.canonical !== 'english' && e.canonical !== 'japanese')
    expect(soft.length).toBeGreaterThan(0)
    for (const s of soft) expect(s.weight, s.canonical).toBeLessThan(1)
  })

  it('mọi kỹ năng có nhãn hiển thị cả hai ngôn ngữ', () => {
    for (const e of tax.all()) {
      expect(e.display.vi, e.canonical).toBeTruthy()
      expect(e.display.en, e.canonical).toBeTruthy()
    }
  })
})

describe('canonicalizeSkills — X-5', () => {
  /**
   * Trường `canonical` có từ đầu nhưng KHÔNG ai điền: đo trên dữ liệu thật chỉ
   * 8/140 kỹ năng có giá trị. Lớp đối chiếu vẫn chạy vì nó tự chuẩn hoá lúc so
   * sánh, nên thiếu sót này im lặng suốt.
   */
  it('gán canonical cho biến thể tên khác nhau', () => {
    const tax = taxonomy()
    const out = canonicalizeSkills<{ name: string; canonical?: string }>(
      [{ name: 'ReactJS' }, { name: 'React.js' }, { name: 'react' }],
      tax,
    )
    const set = new Set(out.map((s) => s.canonical))
    // Ba cách viết phải quy về cùng một khoá
    expect(set.size).toBe(1)
    expect([...set][0]).toBeTruthy()
  })

  it('KHÔNG đổi `name` — đó là chữ người dùng viết và nó hiện lên CV', () => {
    const out = canonicalizeSkills([{ name: 'ReactJS' }], taxonomy())
    expect(out[0]!.name).toBe('ReactJS')
  })

  it('kỹ năng không có trong taxonomy vẫn giữ nguyên, không bị bỏ', () => {
    const out = canonicalizeSkills<{ name: string; canonical?: string }>(
      [{ name: 'Kỹ năng lạ chưa từng có' }],
      taxonomy(),
    )
    expect(out).toHaveLength(1)
    expect(out[0]!.canonical).toBeUndefined()
  })

  it('canonical đã có sẵn thì giữ nguyên, không ghi đè', () => {
    const out = canonicalizeSkills([{ name: 'React', canonical: 'da-co-san' }], taxonomy())
    expect(out[0]!.canonical).toBe('da-co-san')
  })
})
