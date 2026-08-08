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
  ['--color-brand', '#0D9488'],
  ['--color-brand-hover', '#0F766E'],
  ['--color-brand-subtle', '#F0FDFA'],
  ['--color-brand-border', '#99F6E4'],
  ['--color-brand-ink', '#134E4A'],
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
