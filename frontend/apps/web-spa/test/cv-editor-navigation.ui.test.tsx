import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { CVEditorView } from '../src/components/CVEditorView'
import { initialCVs } from './fixtures/cvs'

const noop = () => {}
const cv = initialCVs[0]!

/** jsdom ships no scrollIntoView, so the editor's guard would skip it silently. */
function trackScrolls() {
  const scrolled: HTMLElement[] = []
  const scrollIntoView = vi.fn(function (this: HTMLElement) { scrolled.push(this) })
  Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scrollIntoView, configurable: true, writable: true })
  return scrolled
}

function renderEditor() {
  render(<CVEditorView cv={cv} onUpdateCV={noop} />)
}

afterEach(() => {
  vi.restoreAllMocks()
  delete (Element.prototype as Partial<Element>).scrollIntoView
})

describe('CVEditorView — điều hướng từ panel Sections sang nội dung CV', () => {
  it('scrolls the A4 preview to the section a tree row points at', () => {
    const scrolled = trackScrolls()
    renderEditor()

    fireEvent.click(screen.getByRole('treeitem', { name: 'Kinh nghiệm làm việc' }))

    expect(scrolled).toHaveLength(1)
    expect(scrolled[0]!.dataset.cvNodeId).toBe('experience')
  })

  it('scrolls to the individual entry when a nested row is clicked', () => {
    const scrolled = trackScrolls()
    renderEditor()

    fireEvent.click(screen.getByRole('button', { name: 'Mở rộng Kinh nghiệm làm việc' }))
    fireEvent.click(screen.getByRole('treeitem', { name: 'AI Engineer — IMESPRO' }))

    expect(scrolled).toHaveLength(1)
    expect(scrolled[0]!.dataset.cvItemId).toBe(cv.sections.experience[0]!.id)
  })

  it('marks the pointed-at block in the preview so the jump is visible', () => {
    trackScrolls()
    renderEditor()

    fireEvent.click(screen.getByRole('treeitem', { name: 'Kinh nghiệm làm việc' }))

    const selected = document.querySelectorAll('#a4-cv-paper [data-cv-selected="true"]')
    expect(selected).toHaveLength(1)
    expect((selected[0] as HTMLElement).dataset.cvNodeId).toBe('experience')
  })

  it('never scrolls to the off-screen measurement copy of a block', () => {
    const scrolled = trackScrolls()
    renderEditor()

    fireEvent.click(screen.getByRole('treeitem', { name: 'Kinh nghiệm làm việc' }))

    expect(scrolled[0]!.closest('#a4-cv-paper')).not.toBeNull()
  })
})
