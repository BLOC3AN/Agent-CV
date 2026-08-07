import { describe, it, expect } from 'vitest'
import { ProfileSchema, type Profile } from '@hr/schema'
import { profileCompleteness } from '../src/completeness.js'

/**
 * TC-02-01..04 — mức đầy đủ hồ sơ, BR-02.1.
 *
 * "Hồ sơ đã đầy đủ 82%" là chỗ dễ bịa nhất trong sản phẩm: không ai kiểm được
 * và nó trông có vẻ thông minh. Test này giữ cho nó là một phép tính thật.
 */

const p = (over: Partial<Profile> = {}): Profile =>
  ProfileSchema.parse({ schemaVersion: 1, language: 'vi', basics: { name: 'A' }, ...over })

/** Hồ sơ đạt đủ mọi thành phần */
const full = (): Profile =>
  p({
    basics: { name: 'Trần Hoàng Nam', email: 'nam@example.com', summary: 'Kỹ sư phần mềm.' },
    work: [{ org: 'ABC', role: 'Dev', highlights: ['Giảm thời gian tải từ 3s xuống 0,8s'] }],
    education: [{ school: 'ĐH X', degree: 'Kỹ sư' }],
    skills: ['a', 'b', 'c', 'd', 'e'].map((n) => ({ name: n })),
  } as never)

describe('profileCompleteness', () => {
  it('TC-02-01 hai đầu mút: hồ sơ rỗng → 0, hồ sơ đủ → 100', () => {
    // Sai một trong hai đầu mút thì cả thang đo vô nghĩa.
    // `basics.name` là bắt buộc trong ProfileSchema nên hồ sơ "rỗng" vẫn có
    // tên; chưa có cách liên hệ nào thì phần đó chưa tính là xong.
    expect(profileCompleteness(p()).percent).toBe(0)
    expect(profileCompleteness(full()).percent).toBe(100)
  })

  it('TC-02-02 mỗi thành phần cộng đúng trọng số của nó', () => {
    const only = p({ basics: { name: 'A', email: 'a@example.com' } } as never)
    expect(profileCompleteness(only).percent).toBe(10)

    const plusEdu = p({
      basics: { name: 'A', email: 'a@example.com' },
      education: [{ school: 'X', degree: 'Kỹ sư' }],
    } as never)
    expect(profileCompleteness(plusEdu).percent).toBe(25)
  })

  it('tổng trọng số đúng 100 — nếu không thì không bao giờ đạt 100%', () => {
    const sum = profileCompleteness(p()).parts.reduce((s, x) => s + x.weight, 0)
    expect(sum).toBe(100)
  })

  it('DỰ ÁN thay được kinh nghiệm — sinh viên chưa đi làm không bị trừ điểm', () => {
    // BR-05.2: với sinh viên, dự án mới là phần nhà tuyển dụng đọc kỹ
    const sv = p({
      projects: [{ name: 'Đồ án', tech: [], highlights: ['Xây web bán hàng cho 200 người dùng'] }],
    } as never)
    const part = profileCompleteness(sv).parts.find((x) => x.key === 'experience')
    expect(part!.done).toBe(true)
  })

  it('mục kinh nghiệm RỖNG không tính là xong', () => {
    const rong = p({ work: [{ org: 'ABC', role: 'Dev', highlights: [] }] } as never)
    expect(profileCompleteness(rong).parts.find((x) => x.key === 'experience')!.done).toBe(false)
  })

  it('TC-02-04 phần còn thiếu được nêu ra, NẶNG NHẤT trước', () => {
    const m = profileCompleteness(p({ basics: { name: 'A', email: 'a@example.com' } } as never))
      .missing
    expect(m[0]!.key).toBe('experience') // 30%
    expect(m.map((x) => x.weight)).toEqual([...m.map((x) => x.weight)].sort((a, b) => b - a))
  })

  it('mỗi phần thiếu có VIỆC CẦN LÀM và CHỖ CẦN TỚI', () => {
    // Biết thiếu mà không biết làm gì ở đâu thì cũng như không biết
    for (const x of profileCompleteness(p()).missing) {
      expect(x.todo.length).toBeGreaterThan(10)
      expect(x.path).toMatch(/^\//)
    }
  })

  it('gạch đầu dòng có số liệu: dưới 30% thì chưa tính là có sức nặng', () => {
    const mk = (n: number, có: number) => ({
      org: 'A',
      role: 'Dev',
      highlights: Array.from({ length: n }, (_, i) =>
        i < có ? 'Giảm 40% thời gian xử lý' : 'Tham gia phát triển sản phẩm',
      ),
    })
    const yeu = p({ work: [mk(10, 1)] } as never)
    const du = p({ work: [mk(10, 3)] } as never)
    expect(profileCompleteness(yeu).parts.find((x) => x.key === 'metrics')!.done).toBe(false)
    expect(profileCompleteness(du).parts.find((x) => x.key === 'metrics')!.done).toBe(true)
  })

  it('không có gạch đầu dòng nào → không tính là đã có số liệu', () => {
    expect(profileCompleteness(p()).parts.find((x) => x.key === 'metrics')!.done).toBe(false)
  })
})
