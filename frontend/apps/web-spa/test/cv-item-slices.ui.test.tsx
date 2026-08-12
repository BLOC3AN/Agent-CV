import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { CVBlockRenderer } from '../src/components/CVBlockRenderer'
import { initialCVs } from './fixtures/cvs'
import type { CVLayout } from '../src/types'

const cv = initialCVs[0]!
const layout: CVLayout = {
  version: 1,
  nodes: [{ id: 'experience', type: 'experience', visible: true }],
}
const highlights = cv.sections.experience[0]!.highlights

function renderSlice(itemSlices?: Record<string, { head: boolean; highlights: number[] }>) {
  return render(
    <CVBlockRenderer
      cv={cv}
      layout={layout}
      variant="preview"
      nodeIds={['experience']}
      itemIds={{ experience: ['exp-1'] }}
      itemSlices={itemSlices}
    />,
  )
}

describe('item slices', () => {
  it('renders the whole item when no slice is given', () => {
    const { container } = renderSlice()

    expect(container.textContent).toContain('IMESPRO')
    expect(container.querySelectorAll('ul.cv-bullets li')).toHaveLength(4)
  })

  it('renders the head slice with only its leading bullets', () => {
    const { container } = renderSlice({ 'exp-1': { head: true, highlights: [0] } })

    expect(container.textContent).toContain('IMESPRO')
    const bullets = [...container.querySelectorAll('ul.cv-bullets li')]
    expect(bullets).toHaveLength(1)
    expect(bullets[0]!.textContent).toBe(highlights[0])
  })

  it('renders the tail slice without repeating the item head', () => {
    const { container } = renderSlice({ 'exp-1': { head: false, highlights: [2, 3] } })

    expect(container.textContent).not.toContain('IMESPRO')
    const bullets = [...container.querySelectorAll('ul.cv-bullets li')]
    expect(bullets).toHaveLength(2)
    expect(bullets[0]!.textContent).toBe(highlights[2])
    expect(bullets[1]!.textContent).toBe(highlights[3])
  })

  it('keeps the item selectable on every slice it appears in', () => {
    const { container } = renderSlice({ 'exp-1': { head: false, highlights: [3] } })

    expect(container.querySelector('[data-cv-item-id="exp-1"]')).not.toBeNull()
  })
})
