import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PaginatedA4Document, pageCountForHeight } from '../src/components/PaginatedA4Document'
import { pageGroupsForNodes } from '../src/components/CVPageComposer'

describe('PaginatedA4Document', () => {
  it('keeps ordered blocks together until the shared page content height is full', () => {
    expect(pageGroupsForNodes(
      ['header', 'summary', 'experience', 'education'],
      new Map([['header', 100], ['summary', 250], ['experience', 500], ['education', 180]]),
      800,
    )).toEqual([['header', 'summary'], ['experience', 'education']])
  })

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

  it('renders each composed page with the same physical A4 settings', () => {
    render(
      <PaginatedA4Document
        pageGroups={[['header', 'summary'], ['experience']]}
        renderPage={(keys) => keys.map((key) => <div data-testid={`page-content-${key}`} key={key}>{key}</div>)}
      />,
    )

    const pages = screen.getAllByTestId('a4-page')
    expect(pages).toHaveLength(2)
    for (const page of pages) {
      expect(page).toHaveClass('a4-page')
      expect(page).toHaveAttribute('data-a4-page-settings', 'shared')
      expect(page.getAttribute('style')).toContain('width: 210mm')
      expect(page.getAttribute('style')).toContain('height: 297mm')
    }
    expect(screen.getByTestId('page-content-header')).toBeInTheDocument()
    expect(screen.getByTestId('page-content-experience')).toBeInTheDocument()
  })

  it('separates composed pages with the preview-only page gap', () => {
    render(
      <PaginatedA4Document
        pageGroups={[['header'], ['experience']]}
        renderPage={(keys) => keys.map((key) => <div key={key}>{key}</div>)}
      />,
    )

    expect(screen.getByTestId('a4-document').getAttribute('style')).toContain('gap: var(--cv-page-margin, 0mm)')
    for (const page of screen.getAllByTestId('a4-page')) {
      expect(page.getAttribute('style') ?? '').not.toContain('margin-bottom')
    }
  })
})
