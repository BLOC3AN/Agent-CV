import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { PreviewModal } from '../src/components/PreviewModal'
import { initialCVs } from '../src/mockData'
import type { CVLayout } from '../src/types'

const cv = initialCVs[0]!
const reorderedAndHidden: CVLayout = {
  version: 1,
  nodes: [
    { id: 'experience', type: 'experience', visible: false },
    { id: 'footer', type: 'footer', visible: true },
    { id: 'header', type: 'header', visible: true },
    { id: 'summary', type: 'summary', visible: true },
  ],
}

describe('PreviewModal print mode', () => {
  it('uses the fixed print renderer for Browser Print with reordered and hidden content', () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    render(<PreviewModal isOpen cv={cv} layout={reorderedAndHidden} onClose={() => undefined} onDownloadPDF={() => undefined} />)

    const surface = screen.getByTestId('cv-print-surface')
    expect(surface).toHaveAttribute('data-variant', 'print')
    expect(surface.querySelector('[data-cv-node="experience"]')).toBeNull()
    expect([...surface.querySelectorAll('[data-cv-node]')].map((node) => node.getAttribute('data-cv-node'))).toEqual(['footer', 'header', 'summary'])
    expect(surface.querySelector('.cv-page')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /in \/ print/i }))
    expect(print).toHaveBeenCalledTimes(1)
    print.mockRestore()
  })

  it('keeps long content in the one-column print surface instead of the preview-only grid', () => {
    const longCV = {
      ...cv,
      sections: {
        ...cv.sections,
        experience: Array.from({ length: 8 }, (_, index) => ({
          ...cv.sections.experience[0]!,
          id: `long-${index}`,
          highlights: Array.from({ length: 8 }, (_, bullet) => `Long print content ${index}-${bullet}`),
        })),
      },
    }
    const reorderedVisible: CVLayout = {
      ...reorderedAndHidden,
      nodes: reorderedAndHidden.nodes.map((node) => node.id === 'experience' ? { ...node, visible: true } : node),
    }
    render(<PreviewModal isOpen cv={longCV} layout={reorderedVisible} onClose={() => undefined} onDownloadPDF={() => undefined} />)

    const surface = screen.getByTestId('cv-print-surface')
    expect(within(surface).getByText('LE THANH HAI')).toBeInTheDocument()
    expect(surface.querySelector('.cv-page')).toHaveClass('cv-page')
    expect(surface.querySelector('.cv-two-col')).toBeNull()
    expect(surface.textContent).toContain('Long print content 7-7')
  })
})
