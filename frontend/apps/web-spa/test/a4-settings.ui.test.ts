import { describe, expect, it } from 'vitest'
import { A4_PAGE_SETTINGS, lineHeightForSpacing } from '../src/lib/a4-settings'

describe('A4 page settings', () => {
  it('uses one physical page contract for every renderer', () => {
    expect(A4_PAGE_SETTINGS.width).toBe('210mm')
    expect(A4_PAGE_SETTINGS.height).toBe('297mm')
    expect(A4_PAGE_SETTINGS.padding).toBe('20mm')
    expect(A4_PAGE_SETTINGS.contentWidth).toBe('170mm')
    expect(A4_PAGE_SETTINGS.contentHeight).toBe('257mm')
  })

  it.each([
    ['condensed', '1.15'],
    ['normal', '1.3'],
    ['wide', '1.5'],
  ] as const)('maps %s spacing to the shared line-height', (spacing, expected) => {
    expect(lineHeightForSpacing(spacing)).toBe(expected)
  })
})
