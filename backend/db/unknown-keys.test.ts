import { describe, it, expect } from 'vitest'
import { UNKNOWN_KEY_PREFIX, collectUnknownKeys, setAtPointer, reattachUnknownKeys } from './unknown-keys.js'

describe('collectUnknownKeys', () => {
  it('bắt field lạ lồng trong object (không chỉ top-level)', () => {
    const raw = { basics: { name: 'A', summary: 'bản tóm tắt cũ' } }
    const parsed = { basics: { name: 'A' } }
    const out: Record<string, string> = {}
    collectUnknownKeys(raw, parsed, '', out)
    expect(out).toEqual({ [`${UNKNOWN_KEY_PREFIX}/basics/summary`]: JSON.stringify('bản tóm tắt cũ') })
  })

  it('bắt field lạ nằm trong phần tử mảng', () => {
    const raw = { work: [{ org: 'FPT', legacyField: 'x' }, { org: 'VNG' }] }
    const parsed = { work: [{ org: 'FPT' }, { org: 'VNG' }] }
    const out: Record<string, string> = {}
    collectUnknownKeys(raw, parsed, '', out)
    expect(out).toEqual({ [`${UNKNOWN_KEY_PREFIX}/work/0/legacyField`]: JSON.stringify('x') })
  })

  it('không báo khoá nào khi raw không có field lạ', () => {
    const raw = { basics: { name: 'A' }, work: [{ org: 'FPT' }] }
    const parsed = { basics: { name: 'A' }, work: [{ org: 'FPT' }] }
    const out: Record<string, string> = {}
    collectUnknownKeys(raw, parsed, '', out)
    expect(out).toEqual({})
  })

  it('giữ nguyên kiểu giá trị non-string (number/array/object) qua JSON.stringify', () => {
    const raw = { basics: { score: 42, tags: ['a', 'b'], meta: { x: 1 }, flag: false, note: null } }
    const parsed = { basics: {} }
    const out: Record<string, string> = {}
    collectUnknownKeys(raw, parsed, '', out)
    expect(JSON.parse(out[`${UNKNOWN_KEY_PREFIX}/basics/score`]!)).toBe(42)
    expect(JSON.parse(out[`${UNKNOWN_KEY_PREFIX}/basics/tags`]!)).toEqual(['a', 'b'])
    expect(JSON.parse(out[`${UNKNOWN_KEY_PREFIX}/basics/meta`]!)).toEqual({ x: 1 })
    expect(JSON.parse(out[`${UNKNOWN_KEY_PREFIX}/basics/flag`]!)).toBe(false)
    expect(JSON.parse(out[`${UNKNOWN_KEY_PREFIX}/basics/note`]!)).toBe(null)
  })

  it('field vắng mặt ở raw nhưng có default ở parsed KHÔNG bị coi là field lạ', () => {
    // Chiều ngược lại (có ở parsed, không có ở raw) là default Zod tự điền
    // cho field optional — không phải mất dữ liệu, không phải việc của hàm này.
    const raw = { basics: { name: 'A' } }
    const parsed = { basics: { name: 'A', links: [] } }
    const out: Record<string, string> = {}
    collectUnknownKeys(raw, parsed, '', out)
    expect(out).toEqual({})
  })
})

describe('setAtPointer', () => {
  it('đặt giá trị scalar vào path đã tồn tại sẵn', () => {
    const root: Record<string, unknown> = { basics: { name: 'A' } }
    setAtPointer(root, '/basics/summary', 'bản tóm tắt')
    expect(root).toEqual({ basics: { name: 'A', summary: 'bản tóm tắt' } })
  })

  it('tạo object cha còn thiếu', () => {
    const root: Record<string, unknown> = {}
    setAtPointer(root, '/basics/summary', 'x')
    expect(root).toEqual({ basics: { summary: 'x' } })
  })

  it('tạo mảng cha khi segment kế tiếp là số', () => {
    const root: Record<string, unknown> = {}
    setAtPointer(root, '/work/0/legacyField', 'x')
    expect(root).toEqual({ work: [{ legacyField: 'x' }] })
  })

  it('đặt giá trị non-string (object/array) nguyên vẹn, không stringify lại', () => {
    const root: Record<string, unknown> = { basics: {} }
    setAtPointer(root, '/basics/meta', { x: 1 })
    expect(root).toEqual({ basics: { meta: { x: 1 } } })
  })
})

describe('reattachUnknownKeys', () => {
  it('gắn lại đúng giá trị đã cất, bỏ qua khoá không thuộc namespace /_unrecognized', () => {
    const base: Record<string, unknown> = { basics: { name: 'A' } }
    const droppedFields = {
      [`${UNKNOWN_KEY_PREFIX}/basics/summary`]: JSON.stringify('bản tóm tắt cũ'),
      '/basics/dob': '1999-01-02', // khoá droppedFields khác — không phải việc của hàm này
    }
    const restored = reattachUnknownKeys(base, droppedFields)
    expect(restored).toEqual({ basics: { name: 'A', summary: 'bản tóm tắt cũ' } })
  })

  it('archive rồi reattach khứ hồi đúng — kể cả field lạ lồng trong mảng và giá trị non-string', () => {
    const raw = {
      basics: { name: 'A', summary: 'bản tóm tắt cũ', score: 42 },
      work: [{ org: 'FPT', legacyTags: ['x', 'y'] }],
    }
    const parsed = {
      basics: { name: 'A' },
      work: [{ org: 'FPT' }],
    }
    const droppedFields: Record<string, string> = {}
    collectUnknownKeys(raw, parsed, '', droppedFields)

    // `parsed` đóng vai "profile đã dựng lại từ cvToProfile()" — reattach phải
    // biến nó thành đúng `raw` ban đầu.
    const restored = reattachUnknownKeys(structuredClone(parsed) as Record<string, unknown>, droppedFields)
    expect(restored).toEqual(raw)
  })

  it('raw không có field lạ → droppedFields rỗng → reattach là no-op', () => {
    const raw = { basics: { name: 'A' } }
    const droppedFields: Record<string, string> = {}
    const restored = reattachUnknownKeys(structuredClone(raw) as Record<string, unknown>, droppedFields)
    expect(restored).toEqual(raw)
  })
})
