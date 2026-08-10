import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PaginatedA4Document, pageCountForHeight } from '../src/components/PaginatedA4Document'

describe('PaginatedA4Document', () => {
  it('calculates the minimum number of A4 pages without losing the final partial page', () => {
    expect(pageCountForHeight(1, 100)).toBe(1)
    expect(pageCountForHeight(100, 100)).toBe(1)
    expect(pageCountForHeight(101, 100)).toBe(2)
    expect(pageCountForHeight(299, 100)).toBe(3)
  })

  it('renders one visible A4 shell per measured page', () => {
    render(
      <PaginatedA4Document measuredHeight={890} pageHeight={297}>
        <div>CV content</div>
      </PaginatedA4Document>,
    )

    expect(screen.getAllByTestId('a4-page')).toHaveLength(3)
    expect(screen.getByTestId('a4-document')).toHaveAttribute('aria-label', 'CV 3 trang')
  })
})
