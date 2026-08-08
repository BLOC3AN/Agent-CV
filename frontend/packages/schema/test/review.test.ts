import { describe, it, expect } from 'vitest'
import { ProfileSchema, type Profile } from '../src/profile.js'
import { buildReviewItems, reviewProgress, REVIEW_LABELS } from '../src/review.js'

/**
 * Test cho danh sách mục rà soát — UC-22, BR-22.1.
 *
 * Đây là logic chốt chặn: nút "Tiếp" mở khoá dựa trên nó, và server dùng CÙNG
 * hàm này để chặn ai gọi thẳng API. Sai ở đây thì hoặc user bị khoá vĩnh viễn,
 * hoặc hồ sơ chưa rà soát lọt vào `/builder`.
 */

function profile(over: Partial<Profile> = {}): Profile {
  return ProfileSchema.parse({
    schemaVersion: 1,
    language: 'vi',
    basics: { name: 'Nguyễn Văn A' },
    ...over,
  })
}

describe('buildReviewItems', () => {
  it('luôn có mục thông tin cá nhân, kể cả khi chỉ có tên', () => {
    const items = buildReviewItems(profile())
    expect(items[0]).toMatchObject({ kind: 'basics', path: '/basics' })
  })

  it('PII hiện ra để rà soát — BR-22.3', () => {
    // PII phải HIỆN cho user soát, chỉ là không gửi model ở bước sau
    const items = buildReviewItems(
      profile({ basics: { name: 'A', email: 'a@b.com', phone: '0912345678', links: [] } }),
    )
    const labels = items[0]!.fields.map((f) => f.label)
    expect(labels).toContain('Email')
    expect(labels).toContain('Điện thoại')
    expect(items[0]!.fields.find((f) => f.label === 'Email')!.value).toBe('a@b.com')
  })

  it('mỗi bản ghi học vấn / kinh nghiệm là MỘT mục riêng', () => {
    const items = buildReviewItems(
      profile({
        education: [
          { school: 'ĐH A', degree: 'Kỹ sư', highlights: [] },
          { school: 'ĐH B', degree: 'Thạc sĩ', highlights: [] },
        ],
        work: [{ org: 'Cty X', role: 'Dev', highlights: [] }],
      }),
    )
    expect(items.map((i) => i.path)).toEqual([
      '/basics',
      '/education/0',
      '/education/1',
      '/work/0',
    ])
  })

  it('kỹ năng gộp thành MỘT mục, không tách 44 lần bấm', () => {
    // X-5 ghi nhận CV-10 sinh ra 44 kỹ năng. 44 nút "Đúng rồi" thì không ai rà
    // soát tới cuối — họ bấm bừa và màn hình mất hết ý nghĩa.
    const skills = Array.from({ length: 44 }, (_, i) => ({ name: `Kỹ năng ${i}` }))
    const items = buildReviewItems(profile({ skills }))
    const skillItems = items.filter((i) => i.kind === 'skills')

    expect(skillItems).toHaveLength(1)
    expect(skillItems[0]!.path).toBe('/skills')
    expect(skillItems[0]!.fields[0]!.value).toContain('Kỹ năng 43')
  })

  it('mục rỗng không sinh item — không bắt xác nhận thứ không tồn tại', () => {
    const items = buildReviewItems(profile())
    expect(items.filter((i) => i.kind === 'skills')).toHaveLength(0)
    expect(items.filter((i) => i.kind === 'languages')).toHaveLength(0)
  })

  it('field trống được đánh dấu `empty` để giao diện làm nổi', () => {
    const items = buildReviewItems(profile())
    const email = items[0]!.fields.find((f) => f.label === 'Email')!
    expect(email.empty).toBe(true)
    expect(items[0]!.fields.find((f) => f.label === 'Họ tên')!.empty).toBe(false)
  })

  it('đường dẫn field khớp JSON Pointer dùng cho patch', () => {
    const items = buildReviewItems(profile({ work: [{ org: 'X', role: 'Dev', highlights: [] }] }))
    const work = items.find((i) => i.path === '/work/0')!
    expect(work.fields.map((f) => f.path)).toEqual([
      '/work/0/org',
      '/work/0/role',
      '/work/0/highlights',
    ])
  })

  it('mảng highlights hiện thành chuỗi đọc được', () => {
    const items = buildReviewItems(
      profile({ work: [{ org: 'X', role: 'Dev', highlights: ['A', 'B'] }] }),
    )
    expect(items.find((i) => i.path === '/work/0')!.fields[2]!.value).toBe('A, B')
  })

  it('mọi loại mục đều có nhãn tiếng Việt', () => {
    const items = buildReviewItems(
      profile({
        education: [{ school: 'A', degree: 'B', highlights: [] }],
        work: [{ org: 'A', role: 'B', highlights: [] }],
        projects: [{ name: 'P', tech: [], highlights: [] }],
        skills: [{ name: 'S' }],
        activities: [{ name: 'A', highlights: [] }],
        certifications: [{ name: 'C' }],
        languages: [{ name: 'Tiếng Anh' }],
      }),
    )
    for (const i of items) expect(REVIEW_LABELS[i.kind], i.kind).toBeTruthy()
  })
})

describe('reviewProgress — chốt chặn BR-22.1', () => {
  const items = buildReviewItems(
    profile({
      education: [{ school: 'ĐH A', degree: 'Kỹ sư', highlights: [] }],
      work: [{ org: 'Cty X', role: 'Dev', highlights: [] }],
    }),
  )

  it('hồ sơ vừa import: chưa mục nào được xác nhận', () => {
    const p = reviewProgress(items, {})
    expect(p).toMatchObject({ done: 0, total: 3, complete: false })
    expect(p.pending).toHaveLength(3)
  })

  it('xác nhận từng phần thì chưa hoàn tất', () => {
    const p = reviewProgress(items, { '/basics': true, '/education/0': true })
    expect(p).toMatchObject({ done: 2, total: 3, complete: false })
    expect(p.pending).toEqual(['/work/0'])
  })

  it('xác nhận hết thì mở khoá', () => {
    const all = Object.fromEntries(items.map((i) => [i.path, true]))
    expect(reviewProgress(items, all).complete).toBe(true)
  })

  it('verified = false KHÔNG tính là đã xác nhận', () => {
    // AI sửa đặt verified = false; giá trị đó không được mở khoá nút "Tiếp"
    const all = Object.fromEntries(items.map((i) => [i.path, false]))
    expect(reviewProgress(items, all).complete).toBe(false)
  })

  it('xác nhận đường dẫn KHÔNG có thật không mở khoá được', () => {
    // Client gửi bừa `/education/99` không được vượt qua chốt chặn
    const fake = { '/education/99': true, '/work/42': true, '/basics': true }
    const p = reviewProgress(items, fake)
    expect(p.complete).toBe(false)
    expect(p.pending).toEqual(['/education/0', '/work/0'])
  })

  it('xác nhận field lẻ không thay cho xác nhận cả mục', () => {
    // Đơn vị xác nhận là mục, không phải từng field
    const p = reviewProgress(items, { '/basics/name': true, '/basics/email': true })
    expect(p.done).toBe(0)
  })
})
