import { describe, it, expect, beforeAll } from 'vitest'
import { ProfileSchema, type Profile } from '@hr/schema'
import {
  containsNumber,
  startsWithActionVerb,
  estimatePages,
  allHighlights,
  scoreRubric,
  selectRubric,
  type Rubric,
} from '../src/rubric.js'
import { rubrics } from '../src/kb-load.js'

/**
 * Test lớp rubric — TDD §8.2 lớp 3, §10.3.
 *
 * Đây là lớp mang KINH NGHIỆM HR vào điểm số. Nó chạy được cả khi chưa có JD,
 * và là phần duy nhất chấm CHẤT LƯỢNG bản thân CV chứ không phải độ khớp.
 */

let kb: Rubric[]
beforeAll(() => {
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

describe('containsNumber — bullet có số liệu', () => {
  const YES = [
    'Giảm thời gian phản hồi từ 800ms xuống 120ms',
    'Phục vụ 10.000 người dùng mỗi ngày',
    'Cải thiện hiệu năng 40%',
    'Xử lý 5 triệu bản ghi',
    'Dẫn dắt nhóm 4 thành viên',
    'Reduced latency by 60%',
    'Tiết kiệm 3 giờ mỗi tuần cho đội vận hành',
  ]
  for (const t of YES) {
    it(`nhận: "${t.slice(0, 40)}"`, () => expect(containsNumber(t)).toBe(true))
  }

  const NO = [
    'Xây dựng API bằng NodeJS',
    // Số phiên bản KHÔNG phải thành tích — đây là chỗ dễ nhận nhầm nhất
    'Sử dụng React 18 và Node 20',
    'Phát triển tính năng thanh toán',
    'Làm việc với Python 3',
  ]
  for (const t of NO) {
    it(`KHÔNG nhận: "${t.slice(0, 40)}"`, () => expect(containsNumber(t)).toBe(false))
  }
})

describe('startsWithActionVerb', () => {
  it('chặn mở đầu YẾU — nói lên người khác giao việc, không phải bạn làm ra kết quả', () => {
    for (const t of [
      'Chịu trách nhiệm phát triển tính năng',
      'Tham gia dự án ABC',
      'Được giao nhiệm vụ kiểm thử',
      'Hỗ trợ team trong việc triển khai',
      'Responsible for maintaining the API',
      'Participated in daily standups',
    ]) {
      expect(startsWithActionVerb(t), t).toBe(false)
    }
  })

  it('nhận mở đầu MẠNH', () => {
    for (const t of ['Xây dựng hệ thống', 'Tối ưu truy vấn', 'Built the API', 'Triển khai CI/CD']) {
      expect(startsWithActionVerb(t), t).toBe(true)
    }
  })

  it('không dấu vẫn chặn được', () => {
    expect(startsWithActionVerb('Chiu trach nhiem phat trien')).toBe(false)
  })

  it('chuỗi rỗng → false', () => {
    expect(startsWithActionVerb('   ')).toBe(false)
  })
})

describe('allHighlights', () => {
  it('gom bullet từ MỌI mục kèm đường dẫn', () => {
    const h = allHighlights(
      profile({
        work: [{ org: 'X', role: 'Dev', highlights: ['a', 'b'] }],
        projects: [{ name: 'P', tech: [], highlights: ['c'] }],
        activities: [{ name: 'A', highlights: ['d'] }],
      }),
    )
    expect(h.map((x) => x.path)).toEqual([
      '/work/0/highlights/0',
      '/work/0/highlights/1',
      '/projects/0/highlights/0',
      '/activities/0/highlights/0',
    ])
  })
})

describe('estimatePages', () => {
  it('CV rỗng → 1 trang, không phải 0', () => {
    expect(estimatePages(profile())).toBe(1)
  })

  it('CV dài → nhiều trang', () => {
    const long = profile({
      work: Array.from({ length: 6 }, () => ({
        org: 'Công ty',
        role: 'Developer',
        highlights: Array.from({ length: 6 }, () => 'x'.repeat(160)),
      })),
    })
    expect(estimatePages(long)).toBeGreaterThan(1)
  })
})

describe('selectRubric', () => {
  it('khớp chính xác ngành + vai trò + cấp bậc', () => {
    const r = selectRubric(kb, {
      industry: 'it_software',
      roleFamily: 'backend_developer',
      seniority: 'fresher',
    })
    expect(r?.seniority).toBe('fresher')
  })

  it('KHÔNG chấm fresher bằng thước của senior', () => {
    // Lấy bừa rubric đầu tiên là bất công có hệ thống
    const fresher = selectRubric(kb, {
      industry: 'it_software',
      roleFamily: 'backend_developer',
      seniority: 'fresher',
    })
    const junior = selectRubric(kb, {
      industry: 'it_software',
      roleFamily: 'backend_developer',
      seniority: 'junior',
    })
    expect(fresher?.seniority).not.toBe(junior?.seniority)
  })

  it('không có vai trò khớp → hạ xuống cùng ngành + cùng cấp bậc', () => {
    const r = selectRubric(kb, {
      industry: 'it_software',
      roleFamily: 'khong_ton_tai',
      seniority: 'fresher',
    })
    expect(r?.seniority).toBe('fresher')
  })

  it('ngành lạ hoàn toàn → null, KHÔNG lấy bừa', () => {
    expect(
      selectRubric(kb, { industry: 'nong_nghiep', roleFamily: 'x', seniority: 'fresher' }),
    ).toBeNull()
  })
})

describe('scoreRubric', () => {
  const fresherRubric = (): Rubric =>
    selectRubric(kb, {
      industry: 'it_software',
      roleFamily: 'backend_developer',
      seniority: 'fresher',
    })!

  it('không có rubric → score null, KHÔNG phải 0', () => {
    // 0 điểm nghĩa là "CV tệ"; null nghĩa là "chưa có thước để đo"
    const r = scoreRubric(profile(), null)
    expect(r.score).toBeNull()
    expect(r.rubricId).toBeNull()
  })

  it('CV rỗng bị điểm thấp và có lời khuyên cụ thể', () => {
    const r = scoreRubric(profile(), fresherRubric())
    expect(r.score).toBeLessThan(40)
    expect(r.criteria.some((c) => c.advice !== null)).toBe(true)
  })

  it('CV tốt được điểm cao', () => {
    const good = profile({
      basics: {
        name: 'A',
        email: 'a@b.com',
        phone: '0901234567',
        links: [{ label: 'GitHub', url: 'https://github.com/a' }],
      },
      projects: [
        {
          name: 'Shop',
          tech: ['React'],
          highlights: ['Xây dựng giỏ hàng phục vụ 5.000 người dùng', 'Tối ưu truy vấn giảm 40% thời gian'],
        },
        {
          name: 'Blog',
          tech: ['Next.js'],
          highlights: ['Triển khai CI/CD rút ngắn 30 phút mỗi lần phát hành'],
        },
      ],
    })
    const r = scoreRubric(good, fresherRubric())
    expect(r.score).toBeGreaterThan(70)
  })

  it('tiêu chí `custom` bị TÁCH RA, không cho điểm 0', () => {
    // Chấm bừa còn tệ hơn bỏ qua: "có bullet thể hiện tự đề xuất" không có
    // cách nào đo bằng regex
    const r = scoreRubric(profile(), fresherRubric())
    expect(r.manualCriteria.length).toBeGreaterThan(0)
    expect(r.criteria.every((c) => !c.manual)).toBe(true)
    expect(r.manualCriteria.every((c) => c.manual)).toBe(true)
  })

  it('trọng số chia lại theo phần CHẤM ĐƯỢC', () => {
    // Giữ mẫu số gốc sẽ khiến CV hoàn hảo vẫn mất điểm vì rubric có tiêu chí
    // cần người đánh giá
    const perfect = profile({
      basics: {
        name: 'A',
        email: 'a@b.com',
        phone: '0901234567',
        links: [{ label: 'GitHub', url: 'https://github.com/a' }],
      },
      projects: [
        { name: 'P1', tech: [], highlights: ['Xây dựng API phục vụ 10.000 người dùng'] },
        { name: 'P2', tech: [], highlights: ['Tối ưu truy vấn giảm 50% thời gian'] },
      ],
    })
    const r = scoreRubric(perfect, fresherRubric())
    expect(r.score).toBe(100)
  })

  it('mỗi tiêu chí nói rõ ĐO ĐƯỢC GÌ và KỲ VỌNG GÌ', () => {
    const r = scoreRubric(profile({ projects: [{ name: 'P', tech: [], highlights: [] }] }), fresherRubric())
    const c = r.criteria.find((x) => x.id === 'project_count')!
    expect(c.actual).toBe('1')
    expect(c.expected).toBe('≥ 2')
    expect(c.passed).toBe(false)
    expect(c.advice?.vi).toBeTruthy()
  })

  it('điểm theo TỈ LỆ, không phải đạt/không đạt', () => {
    // 1/2 dự án tốt hơn 0/2 — thang nhị phân làm user không thấy mình tiến bộ
    const zero = scoreRubric(profile(), fresherRubric())
    const one = scoreRubric(
      profile({ projects: [{ name: 'P', tech: [], highlights: [] }] }),
      fresherRubric(),
    )
    const c0 = zero.criteria.find((x) => x.id === 'project_count')!
    const c1 = one.criteria.find((x) => x.id === 'project_count')!
    expect(c1.score).toBeGreaterThan(c0.score)
  })

  it('đạt vượt mức không cho quá 100', () => {
    const many = profile({
      projects: Array.from({ length: 8 }, (_, i) => ({ name: `P${i}`, tech: [], highlights: [] })),
    })
    const c = scoreRubric(many, fresherRubric()).criteria.find((x) => x.id === 'project_count')!
    expect(c.score).toBe(100)
  })

  it('thiếu GitHub bị trừ nhưng NHẸ hơn thiếu email', () => {
    const noGithub = profile({
      basics: { name: 'A', email: 'a@b.com', phone: '0901234567', links: [] },
    })
    const noEmail = profile({
      basics: { name: 'A', links: [{ label: 'GitHub', url: 'https://github.com/a' }] },
    })
    const g = scoreRubric(noGithub, fresherRubric()).criteria.find((c) => c.id === 'contact_completeness')!
    const e = scoreRubric(noEmail, fresherRubric()).criteria.find((c) => c.id === 'contact_completeness')!
    expect(g.score).toBeGreaterThan(e.score)
  })

  it('điểm nằm trong 0..100 và là số nguyên', () => {
    for (const p of [profile(), profile({ work: [{ org: 'X', role: 'Y', highlights: ['z'] }] })]) {
      const s = scoreRubric(p, fresherRubric()).score!
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThanOrEqual(100)
      expect(Number.isInteger(s)).toBe(true)
    }
  })

  it('deterministic', () => {
    const p = profile({ projects: [{ name: 'P', tech: [], highlights: ['Xây dựng X'] }] })
    const runs = Array.from({ length: 5 }, () => scoreRubric(p, fresherRubric()).score)
    expect(new Set(runs).size).toBe(1)
  })
})

describe('KB rubric hợp lệ', () => {
  it('đọc được và có nhiều cấp bậc', () => {
    expect(kb.length).toBeGreaterThanOrEqual(2)
    expect(new Set(kb.map((r) => r.seniority)).size).toBeGreaterThanOrEqual(2)
  })

  it('trọng số mỗi rubric cộng lại xấp xỉ 1.0', () => {
    for (const r of kb) {
      const sum = r.criteria.reduce((s, c) => s + c.weight, 0)
      expect(sum, `${r.seniority}: tổng trọng số ${sum}`).toBeCloseTo(1, 1)
    }
  })

  it('mọi tiêu chí có lời khuyên khi không đạt', () => {
    // Chấm mà không nói cách sửa thì chỉ làm user lo, không giúp được gì
    for (const r of kb) {
      for (const c of r.criteria) {
        const has = c.advice_when_below ?? c.advice_when_above
        expect(has, `${r.seniority}/${c.id} thiếu lời khuyên`).toBeTruthy()
      }
    }
  })

  it('mọi `path` của tiêu chí count đều giải được', () => {
    // Path gõ sai làm tiêu chí âm thầm chuyển thành `manual` và biến mất khỏi điểm
    const p = profile()
    for (const r of kb) {
      for (const c of r.criteria.filter((x) => x.type === 'count')) {
        const res = scoreRubric(p, { ...r, criteria: [c] })
        expect(res.criteria.length, `${r.seniority}/${c.id}: path "${c.path}" không giải được`).toBe(1)
      }
    }
  })
})
