import { describe, it, expect, beforeAll } from 'vitest'
import { ProfileSchema, type Profile } from '@hr/schema'
import { cvHealth } from '../src/health.js'
import { rubrics } from '../src/kb-load.js'
import type { Rubric } from '../src/rubric.js'

/**
 * TC-04-01..07 — chẩn đoán sức khoẻ CV. UC-04.
 *
 * Nhóm người dùng đông nhất hỏi "CV tôi có ổn không", không phải "tôi có hợp
 * việc này không". Trả lời được câu đó mà KHÔNG cần tin tuyển dụng là điểm
 * khác biệt của sản phẩm.
 */

let kb: Rubric[]
beforeAll(() => {
  kb = rubrics()
})

const p = (over: Partial<Profile> = {}): Profile =>
  ProfileSchema.parse({ schemaVersion: 1, language: 'vi', basics: { name: 'A' }, ...over })

const weak = () =>
  p({
    work: [{ org: 'ABC', role: 'Dev', highlights: ['Tham gia phát triển sản phẩm'] }],
  } as never)

const strong = () =>
  p({
    basics: { name: 'A', introduce: 'Kỹ sư phần mềm 3 năm kinh nghiệm.' },
    work: [
      {
        org: 'ABC',
        role: 'Backend Developer',
        highlights: [
          'Xây dựng API phục vụ 50.000 người dùng mỗi ngày',
          'Giảm thời gian phản hồi từ 3s xuống 0,8s',
          'Thiết kế pipeline xử lý 2 triệu bản ghi',
        ],
      },
    ],
    projects: [
      { name: 'Shop', tech: ['Node.js'], highlights: ['Phục vụ 1.200 đơn mỗi tháng'] },
      { name: 'Blog', tech: ['Next.js'], highlights: ['Tối ưu tải trang xuống 1,2s'] },
    ],
    education: [{ school: 'ĐH X', degree: 'Kỹ sư', gpa: '3.4' }],
    skills: ['Node.js', 'TypeScript', 'Docker', 'PostgreSQL', 'Redis'].map((n) => ({ name: n })),
  } as never)

describe('cvHealth', () => {
  it('TC-04-02 chấm được KHÔNG cần tin tuyển dụng', () => {
    const h = cvHealth({ profile: strong(), rubrics: kb })
    expect(h.scored).toBe(true)
    expect(h.overall).toBeGreaterThan(0)
  })

  it('TC-04-01 mỗi thanh nối vào một tiêu chí rubric CÓ THẬT', () => {
    // Cấm vẽ thanh bằng số bịa — đã trả giá cho việc đo sai thứ (TDD §8.2)
    const h = cvHealth({ profile: strong(), rubrics: kb })
    const ids = new Set(kb.flatMap((r) => r.criteria.map((c) => c.id)))
    expect(h.bars.length).toBeGreaterThan(0)
    for (const b of h.bars) {
      expect(ids.has(b.id), `thanh "${b.id}" không có tiêu chí nào tương ứng`).toBe(true)
      expect(b.score).toBeGreaterThanOrEqual(0)
      expect(b.score).toBeLessThanOrEqual(100)
    }
  })

  it('TC-04-03 không rubric nào áp dụng được → nói thẳng, KHÔNG vẽ thanh rỗng', () => {
    const h = cvHealth({ profile: strong(), rubrics: [] })
    expect(h.scored).toBe(false)
    expect(h.overall).toBeNull()
    expect(h.bars).toEqual([])
    expect(h.fixes).toEqual([])
  })

  it('TC-04-04 tối đa 3 việc nên sửa', () => {
    // Liệt kê 12 lỗi khiến người ta đóng tab
    expect(cvHealth({ profile: weak(), rubrics: kb }).fixes.length).toBeLessThanOrEqual(3)
  })

  it('TC-04-05 mỗi việc TRỎ ĐƯỢC vào một chỗ cụ thể', () => {
    // "Hãy làm CV chuyên nghiệp hơn" là lời khuyên vô dụng
    for (const f of cvHealth({ profile: weak(), rubrics: kb }).fixes) {
      expect(f.path).toMatch(/^\//)
      expect(f.section.length).toBeGreaterThan(2)
      expect(f.advice.length).toBeGreaterThan(20)
    }
  })

  it('việc nặng nhất đứng trước', () => {
    const fixes = cvHealth({ profile: weak(), rubrics: kb }).fixes
    const w = kb[0]!.criteria
    const weightOf = (id: string) => w.find((c) => c.id === id)?.weight ?? 0
    const ws = fixes.map((f) => weightOf(f.id))
    expect(ws).toEqual([...ws].sort((a, b) => b - a))
  })

  it('TC-04-06 CV tốt → ÍT việc phải sửa hơn CV yếu', () => {
    const tot = cvHealth({ profile: strong(), rubrics: kb })
    const yeu = cvHealth({ profile: weak(), rubrics: kb })
    expect(tot.overall!).toBeGreaterThan(yeu.overall!)
    expect(tot.fixes.length).toBeLessThanOrEqual(yeu.fixes.length)
  })

  it('TC-04-07 nêu được ĐIỂM MẠNH, không chỉ điểm yếu', () => {
    // Cùng một sự thật, "CV bạn yếu" và "đây là 3 thứ sửa xong sẽ khác hẳn"
    // cho hai kết cục khác nhau
    const h = cvHealth({ profile: strong(), rubrics: kb })
    expect(h.strengths.length).toBeGreaterThan(0)
    for (const s of h.strengths) expect(s.verdict).toBe('good')
  })

  it('nhãn định tính khớp với điểm', () => {
    for (const b of cvHealth({ profile: weak(), rubrics: kb }).bars) {
      if (b.score >= 75) expect(b.verdict).toBe('good')
      else if (b.score >= 50) expect(b.verdict).toBe('ok')
      else expect(b.verdict).toBe('weak')
    }
  })

  it('tiêu chí cần người đánh giá tách riêng, không trộn vào điểm', () => {
    const h = cvHealth({ profile: strong(), rubrics: kb })
    for (const m of h.manual) expect(h.bars.find((b) => b.id === m.id)).toBeUndefined()
  })

  it('CV rỗng không làm sập, và không cho điểm cao', () => {
    const h = cvHealth({ profile: p(), rubrics: kb })
    expect(h.scored).toBe(true)
    expect(h.overall!).toBeLessThan(40)
  })
})
