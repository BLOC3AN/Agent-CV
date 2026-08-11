import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CVEditorView } from '../src/components/CVEditorView'
import { initialCVs } from '../src/mockData'
import type { CV } from '../src/types'

const noop = () => {}

function renderEditorWithExperienceOpen(onUpdateCV: (cv: CV) => void = noop) {
  render(
    <CVEditorView
      cv={initialCVs[0]!}
      onUpdateCV={onUpdateCV}
      onOpenPreview={noop}
      onOpenShare={noop}
      onDownloadPDF={noop}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Mở rộng Kinh nghiệm làm việc' }))
  fireEvent.doubleClick(screen.getByRole('treeitem', { name: 'AI Engineer — IMESPRO' }))
}

describe('CVEditorView — chỉnh sửa highlights qua Component Tree', () => {
  it('mở field Highlights của job được chọn', () => {
    renderEditorWithExperienceOpen()
    expect(screen.getByLabelText('Highlights')).toBeInTheDocument()
    expect(screen.getByLabelText('Highlights')).toHaveValue(initialCVs[0]!.sections.experience[0]!.highlights.join('\n'))
  })

  it('thêm được một dòng mới trong Highlights', () => {
    let updated: CV | null = null
    renderEditorWithExperienceOpen((cv) => { updated = cv })
    const highlights = screen.getByLabelText('Highlights')
    fireEvent.change(highlights, { target: { value: `${(highlights as HTMLTextAreaElement).value}\nNew measurable result` } })
    fireEvent.click(screen.getByRole('button', { name: 'Cập nhật bản nháp' }))
    expect(updated!.sections.experience[0]!.highlights).toContain('New measurable result')
  })

  it('xoá được một dòng bằng cách cập nhật Highlights', () => {
    let updated: CV | null = null
    renderEditorWithExperienceOpen((cv) => { updated = cv })
    const existing = initialCVs[0]!.sections.experience[0]!.highlights
    fireEvent.change(screen.getByLabelText('Highlights'), { target: { value: existing.slice(1).join('\n') } })
    fireEvent.click(screen.getByRole('button', { name: 'Cập nhật bản nháp' }))
    expect(updated!.sections.experience[0]!.highlights).toEqual(existing.slice(1))
  })

  it('chỉnh đúng job con được double-click, không trộn với job khác', () => {
    let updated: CV | null = null
    render(
      <CVEditorView cv={initialCVs[0]!} onUpdateCV={(cv) => { updated = cv }} onOpenPreview={noop} onOpenShare={noop} onDownloadPDF={noop} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Mở rộng Kinh nghiệm làm việc' }))
    fireEvent.doubleClick(screen.getByRole('treeitem', { name: 'AI Engineer — bTaskee' }))
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'Updated role' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cập nhật bản nháp' }))
    expect(updated!.sections.experience[0]!.title).not.toBe('Updated role')
    expect(updated!.sections.experience[1]!.title).toBe('Updated role')
  })
})
