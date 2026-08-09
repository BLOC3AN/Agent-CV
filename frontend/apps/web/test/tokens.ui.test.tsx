import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Token là hợp đồng giữa tầng thiết kế và mọi component sau nó.
 * Đọc thẳng globals.css chứ không render: happy-dom không chạy Tailwind,
 * nên kiểm bằng DOM sẽ luôn xanh dù token chưa hề được khai.
 */

let css = ''
beforeAll(() => {
  css = readFileSync(resolve(__dirname, '../app/globals.css'), 'utf8')
})

const REQUIRED = [
  // Indigo chứ không teal: D10 (spec 2026-08-07 §2) đè D1 để apps/web khớp
  // bản SPA đã duyệt. Đổi ở đây thì phải đổi cả globals.css và spec.
  ['--color-brand', '#4F46E5'],
  ['--color-brand-hover', '#4338CA'],
  ['--color-brand-subtle', '#EEF2FF'],
  ['--color-brand-border', '#C7D2FE'],
  ['--color-brand-ink', '#3730A3'],
  ['--color-ink', '#0F172A'],
  ['--color-ink-muted', '#475569'],
  ['--color-ink-subtle', '#94A3B8'],
  ['--color-surface', '#FFFFFF'],
  ['--color-canvas', '#F8FAFC'],
  ['--color-border', '#E2E8F0'],
  ['--color-border-strong', '#CBD5E1'],
  ['--color-success', '#059669'],
  ['--color-success-subtle', '#ECFDF5'],
  ['--color-warn', '#D97706'],
  ['--color-warn-subtle', '#FFFBEB'],
  ['--color-danger', '#DC2626'],
  ['--color-danger-subtle', '#FEF2F2'],
]

describe('tầng token', () => {
  it.each(REQUIRED)('khai %s = %s', (name, value) => {
    expect(css).toMatch(new RegExp(`${name}:\\s*${value};`, 'i'))
  })

  it('khối @theme tồn tại', () => {
    expect(css).toContain('@theme')
  })

  it('KHÔNG còn khai màu trong :root ngoài @theme — token phải ở một chỗ', () => {
    const rootBlock = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rootBlock).not.toMatch(/--color-/)
  })
})
