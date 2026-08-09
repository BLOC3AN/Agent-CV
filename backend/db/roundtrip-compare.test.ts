import { describe, it, expect } from 'vitest'
import { ProfileSchema, profileToCV } from '@hr/schema'
import { collectUnknownKeys } from './unknown-keys.js'
import { canon, diffRestored, assertReversible } from './roundtrip-compare.js'

const META = { id: 'cv-1', title: 'CV', lastModified: '2026-08-09T10:00:00Z' }

/** Dựng data_v2 đúng như backfill-v2.ts dựng, kể cả bước cất khoá lạ. */
function buildV2(raw: unknown): unknown {
  const profile = ProfileSchema.parse(raw)
  const parsedForDiff = JSON.parse(JSON.stringify(profile)) as unknown
  const unknownKeys: Record<string, string> = {}
  collectUnknownKeys(raw, parsedForDiff, '', unknownKeys)
  const cv = profileToCV(profile, META)
  Object.assign(cv._meta.droppedFields, unknownKeys)
  return JSON.parse(JSON.stringify(cv))
}

const RAW = {
  schemaVersion: 1,
  language: 'vi',
  basics: {
    name: 'Nguyễn Văn A',
    headline: 'Kỹ sư AI',
    dob: '1999-01-02',
    // Khoá ProfileSchema không biết — sót lại từ trước migration 009. Chính
    // field này đã biến mất trong sự cố dữ liệu thật.
    summary: 'tóm tắt cũ',
    links: [],
  },
  work: [{ org: 'FPT', role: 'Engineer', type: 'fulltime', highlights: ['a'] }],
  education: [],
  projects: [],
  skills: [{ name: 'Go', group: 'Ngôn ngữ' }],
  activities: [],
  certifications: [],
  languages: [],
  _meta: { verified: { '/basics/name': true }, source: 'manual' },
}

describe('canon', () => {
  it('sắp xếp khoá ở mọi cấp để so sánh không phụ thuộc thứ tự khoá', () => {
    expect(JSON.stringify(canon({ b: 1, a: { d: 2, c: [{ f: 1, e: 2 }] } }))).toBe(
      JSON.stringify({ a: { c: [{ e: 2, f: 1 }], d: 2 }, b: 1 }),
    )
  })
})

describe('diffRestored', () => {
  it('trả null khi data_v2 khôi phục lại đúng raw (kể cả khoá lạ)', () => {
    expect(diffRestored(RAW, buildV2(RAW))).toBeNull()
  })

  it('báo lệch khi data_v2 đánh mất một field đã cất', () => {
    const v2 = buildV2(RAW) as { _meta: { droppedFields: Record<string, string> } }
    delete v2._meta.droppedFields['/basics/dob']
    const diff = diffRestored(RAW, v2)
    expect(diff).not.toBeNull()
    expect(diff).toMatch(/dob|1999/)
  })

  it('báo lệch khi data_v2 đánh mất khoá ProfileSchema không biết tới', () => {
    const v2 = buildV2(RAW) as { _meta: { droppedFields: Record<string, string> } }
    delete v2._meta.droppedFields['/_unrecognized/basics/summary']
    expect(diffRestored(RAW, v2)).toMatch(/summary|tóm tắt/)
  })

  it('lỗi khi dựng lại cũng là "không chứng minh được", không phải ngoại lệ lọt ra ngoài', () => {
    const v2 = buildV2(RAW) as { _meta: { droppedFields: Record<string, string> } }
    delete v2._meta.droppedFields['/skills/_order']
    expect(diffRestored(RAW, v2)).toMatch(/skills\/_order|lỗi khi dựng lại/)
  })
})

describe('assertReversible', () => {
  it('không ném gì khi khôi phục nguyên vẹn', () => {
    expect(() => assertReversible(RAW, buildV2(RAW))).not.toThrow()
  })

  it('ném lỗi khi không khôi phục được — backfill phải từ chối ghi hàng đó', () => {
    const v2 = buildV2(RAW) as { _meta: { droppedFields: Record<string, string> } }
    delete v2._meta.droppedFields['/basics/dob']
    expect(() => assertReversible(RAW, v2)).toThrow(/không khôi phục lại được|KHÔNG khớp/i)
  })
})
