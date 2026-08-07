import { describe, it, expect } from 'vitest'
import { ProfileSchema, type Profile, type PatchOp } from '@hr/schema'
import {
  applyProfilePatch,
  replay,
  markUnverified,
  markVerified,
} from '../src/patch.js'

/**
 * TC-24-01 · TC-53-05 · TC-53-07 · TC-53-08 · TC-54-01/02
 * Đường ống patch — dùng chung cho thay đổi của NGƯỜI và của AI (BR-24.1).
 */

const base = (): Profile =>
  ProfileSchema.parse({
    schemaVersion: 1,
    language: 'vi',
    basics: { name: 'Nguyễn Minh Khôi', headline: 'Backend Developer' },
    work: [
      {
        org: 'ABC',
        role: 'Thực tập sinh',
        highlights: ['Làm đồ án website bán hàng', 'Viết test case'],
      },
    ],
    skills: [{ name: 'Node.js' }],
  })

const op = (o: Partial<PatchOp> & Pick<PatchOp, 'op' | 'path'>): PatchOp => ({
  rationale: 'lý do đủ dài để qua schema',
  grounding: { type: 'user_message', ref: 'msg_1' },
  kbRefs: [],
  ...o,
} as PatchOp)

describe('TC-24-01 — áp patch hợp lệ', () => {
  it('replace một bullet', () => {
    const r = applyProfilePatch(base(), [
      op({ op: 'replace', path: '/work/0/highlights/0', value: 'Xây dựng website TMĐT' }),
    ])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.profile.work[0]!.highlights[0]).toBe('Xây dựng website TMĐT')
    expect(r.applied).toHaveLength(1)
    expect(r.rejected).toHaveLength(0)
  })

  it('add phần tử mới vào mảng', () => {
    const r = applyProfilePatch(base(), [
      op({ op: 'add', path: '/skills/-', value: { name: 'PostgreSQL' } }),
    ])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.profile.skills).toHaveLength(2)
  })

  it('remove', () => {
    const r = applyProfilePatch(base(), [op({ op: 'remove', path: '/work/0/highlights/1' })])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.profile.work[0]!.highlights).toHaveLength(1)
  })
})

describe('TC-53-07 — op sai bị bỏ RIÊNG, phần còn lại vẫn áp dụng', () => {
  it('path không tồn tại → bỏ op đó thôi', () => {
    const r = applyProfilePatch(base(), [
      op({ op: 'replace', path: '/khong/ton/tai/0', value: 'x' }),
      op({ op: 'replace', path: '/basics/headline', value: 'Fullstack Developer' }),
    ])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.applied).toHaveLength(1)
    expect(r.rejected).toHaveLength(1)
    expect(r.profile.basics.headline).toBe('Fullstack Developer')
  })

  it('op phá schema bị chặn (xoá field bắt buộc)', () => {
    const r = applyProfilePatch(base(), [op({ op: 'remove', path: '/basics/name' })])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.rejected[0]?.reason).toMatch(/phá schema/)
  })

  it('sai kiểu dữ liệu bị chặn', () => {
    const r = applyProfilePatch(base(), [
      op({ op: 'replace', path: '/skills', value: 'không phải mảng' }),
    ])
    expect(r.ok).toBe(false)
  })

  it('op move thiếu "from" bị từ chối', () => {
    const r = applyProfilePatch(base(), [op({ op: 'move', path: '/skills/1' })])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.rejected[0]?.reason).toMatch(/thiếu trường "from"/)
  })

  it('add thiếu value bị từ chối', () => {
    const r = applyProfilePatch(base(), [op({ op: 'add', path: '/skills/-' })])
    expect(r.ok).toBe(false)
  })

  it('không op nào áp được → ok:false, KHÔNG ghi gì', () => {
    const r = applyProfilePatch(base(), [
      op({ op: 'replace', path: '/a/b', value: 1 }),
      op({ op: 'replace', path: '/c/d', value: 2 }),
    ])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.rejected).toHaveLength(2)
  })
})

describe('TC-54-01/02 — undo dùng CHUNG cơ chế cho user và AI', () => {
  it('patch nghịch đảo khôi phục đúng trạng thái trước', () => {
    const before = base()
    const r = applyProfilePatch(before, [
      op({ op: 'replace', path: '/work/0/highlights/0', value: 'ĐÃ SỬA' }),
      op({ op: 'add', path: '/skills/-', value: { name: 'Docker' } }),
    ])
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const restored = replay(r.profile, [r.inverse])
    expect(restored.work[0]!.highlights[0]).toBe('Làm đồ án website bán hàng')
    expect(restored.skills).toHaveLength(1)
    expect(JSON.stringify(restored)).toBe(JSON.stringify(before))
  })

  it('undo nhiều bước liên tiếp', () => {
    let p = base()
    const inverses = []
    for (const v of ['A', 'B', 'C']) {
      const r = applyProfilePatch(p, [
        op({ op: 'replace', path: '/basics/headline', value: v }),
      ])
      expect(r.ok).toBe(true)
      if (!r.ok) return
      p = r.profile
      inverses.unshift(r.inverse)
    }
    expect(p.basics.headline).toBe('C')
    const back = replay(p, inverses)
    expect(back.basics.headline).toBe('Backend Developer')
  })
})

describe('TC-53-08 — đánh dấu xác nhận', () => {
  it('AI sửa → verified = false', () => {
    const ops = [op({ op: 'replace', path: '/basics/headline', value: 'X' })]
    const p = markUnverified(base(), ops)
    expect(p._meta.verified['/basics/headline']).toBe(false)
  })

  it('người sửa → verified = true (BR-24.2)', () => {
    const ops = [op({ op: 'replace', path: '/basics/headline', value: 'X' })]
    const p = markVerified(base(), ops)
    expect(p._meta.verified['/basics/headline']).toBe(true)
  })

  it('remove thì xoá luôn cờ, không để rác', () => {
    let p = markUnverified(base(), [op({ op: 'replace', path: '/skills/0/name', value: 'X' })])
    expect(p._meta.verified['/skills/0/name']).toBe(false)
    p = markVerified(p, [op({ op: 'remove', path: '/skills/0/name' })])
    expect('/skills/0/name' in p._meta.verified).toBe(false)
  })
})

describe('Không đột biến đầu vào', () => {
  it('applyProfilePatch không sửa Profile gốc', () => {
    const before = base()
    const snapshot = JSON.stringify(before)
    applyProfilePatch(before, [
      op({ op: 'replace', path: '/basics/headline', value: 'ĐỔI' }),
    ])
    expect(JSON.stringify(before)).toBe(snapshot)
  })
})
