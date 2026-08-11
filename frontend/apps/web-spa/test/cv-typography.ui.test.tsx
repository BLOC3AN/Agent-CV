import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { CVEditorView } from '../src/components/CVEditorView'
import { initialCVs } from '../src/mockData'
import type { CV } from '../src/types'
import { resolveCVTypography } from '../src/lib/cv-typography'

function renderEditor() {
  function Harness() {
    const [current, setCurrent] = useState(() => structuredClone(initialCVs[0]!) as CV)
    return <CVEditorView cv={current} onUpdateCV={setCurrent} onOpenPreview={() => undefined} onOpenShare={() => undefined} onDownloadPDF={() => undefined} />
  }
  render(<Harness />)
}

describe('CV typography controls', () => {
  it('offers Auto and Vietnamese-safe font choices in the Design tab', () => {
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: /thiết kế/i }))
    const select = screen.getByLabelText('Font chữ')
    expect(select).toHaveValue('Open Sans')
    expect([...select.querySelectorAll('option')].map((option) => option.value)).toEqual(['Auto', 'Calibri', 'Arial', 'Times New Roman', 'Roboto', 'Open Sans', 'Lato'])
    fireEvent.change(select, { target: { value: 'Auto' } })
    expect(select).toHaveValue('Auto')
  })

  it('shows three independent point-size controls', () => {
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: /thiết kế/i }))
    expect(screen.getByLabelText('Cỡ chữ nội dung')).toHaveAttribute('min', '9')
    expect(screen.getByLabelText('Cỡ chữ nội dung')).toHaveAttribute('max', '14')
    expect(screen.getByLabelText('Cỡ tiêu đề section')).toHaveAttribute('min', '10')
    expect(screen.getByLabelText('Cỡ tiêu đề section')).toHaveAttribute('max', '16')
    expect(screen.getByLabelText('Cỡ header')).toHaveAttribute('min', '16')
    expect(screen.getByLabelText('Cỡ header')).toHaveAttribute('max', '28')
  })

  it('applies each typography size to the live A4 surface independently', () => {
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: /thiết kế/i }))
    fireEvent.change(screen.getByLabelText('Cỡ chữ nội dung'), { target: { value: '11' } })
    fireEvent.change(screen.getByLabelText('Cỡ tiêu đề section'), { target: { value: '13' } })
    fireEvent.change(screen.getByLabelText('Cỡ header'), { target: { value: '24' } })
    const paper = document.querySelector('#a4-cv-paper') as HTMLElement
    expect(paper.style.getPropertyValue('--cv-body-size')).toBe('11pt')
    expect(paper.style.getPropertyValue('--cv-section-title-size')).toBe('13pt')
    expect(paper.style.getPropertyValue('--cv-header-size')).toBe('24pt')
  })

  it('keeps Intro body content on the shared body-size variable', () => {
    renderEditor()
    const summary = screen.getByTestId('cv-block-summary') as HTMLElement
    expect(summary.style.fontSize).toBe('var(--cv-body-size)')
  })

  it('uses one selected font family for Intro and Experience blocks', () => {
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: /thiết kế/i }))
    fireEvent.change(screen.getByLabelText('Font chữ'), { target: { value: 'Times New Roman' } })

    const summary = screen.getByTestId('cv-block-summary') as HTMLElement
    const experience = screen.getByTestId('cv-block-experience') as HTMLElement
    expect(summary.style.fontFamily).toBe('var(--cv-font-family)')
    expect(experience.style.fontFamily).toBe('var(--cv-font-family)')
    expect(summary.style.fontSize).toBe('var(--cv-body-size)')
    expect(experience.style.fontSize).toBe('var(--cv-body-size)')
    expect(summary.style.lineHeight).toBe('inherit')
    expect(experience.style.lineHeight).toBe('inherit')
    expect(document.querySelector('#a4-cv-paper') as HTMLElement).toHaveStyle('--cv-font-family: "Times New Roman", Times, serif')
  })

  it('resolves Auto to Calibri and preserves legacy body-size fallback', () => {
    expect(resolveCVTypography({ font: 'Auto', fontSize: 12 })).toEqual({
      fontFamily: 'Calibri, Arial, sans-serif', bodyFontSize: 12, sectionTitleFontSize: 11, headerFontSize: 20,
    })
    expect(resolveCVTypography({ font: 'Auto', fontSize: 14 }).bodyFontSize).toBe(10.5)
    expect(resolveCVTypography({ font: 'Auto', fontSize: 14, bodyFontSize: 14 }).bodyFontSize).toBe(14)
  })

  it('applies the selected font family to the live CV surface', () => {
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: /thiết kế/i }))
    const select = screen.getByLabelText('Font chữ')
    const paper = document.querySelector('#a4-cv-paper') as HTMLElement

    fireEvent.change(select, { target: { value: 'Arial' } })
    expect(paper.style.getPropertyValue('--cv-font-family')).toBe('Arial, Helvetica, sans-serif')
    fireEvent.change(select, { target: { value: 'Times New Roman' } })
    expect(paper.style.getPropertyValue('--cv-font-family')).toBe('"Times New Roman", Times, serif')
  })
})
