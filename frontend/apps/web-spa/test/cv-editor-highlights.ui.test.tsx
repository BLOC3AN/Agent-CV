import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CVEditorView } from '../src/components/CVEditorView'
import { initialCVs } from '../src/mockData'
import type { CV } from '../src/types'

const noop = () => {}

/**
 * `CVEditorView` nhận `{ cv, onUpdateCV, onOpenPreview, onOpenShare,
 * onDownloadPDF }`, không phải `{ cv, onChange }` như bản nháp kế hoạch —
 * đọc file thật trước khi viết test theo đúng hướng dẫn của task.
 *
 * Khay sửa từng mục (chứa các ô nhập gạch đầu dòng) chỉ hiện sau khi bấm nút
 * "Chỉnh sửa phần này" của mục đó — `editingSection` mặc định là `null`.
 * Mục "Kinh nghiệm làm việc" là mục thứ hai trong danh sách nên nút của nó
 * là phần tử thứ hai (index 1) trong tập nút cùng tiêu đề.
 */
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
  fireEvent.click(screen.getAllByTitle(/chỉnh sửa phần này/i)[1]!)
}

describe('CVEditorView — bullet sửa từng dòng', () => {
  it('hiện mỗi highlight thành một ô nhập riêng', () => {
    renderEditorWithExperienceOpen()
    const inputs = screen.getAllByRole('textbox', { name: /gạch đầu dòng/i })
    expect(inputs.length).toBeGreaterThanOrEqual(2)
  })

  it('thêm được một dòng mới', () => {
    let updated: CV | null = null
    renderEditorWithExperienceOpen((cv) => {
      updated = cv
    })
    fireEvent.click(screen.getAllByRole('button', { name: /thêm gạch đầu dòng/i })[0]!)
    expect(updated!.sections.experience[0]!.highlights).toHaveLength(
      initialCVs[0]!.sections.experience[0]!.highlights.length + 1,
    )
  })

  it('xoá được một dòng', () => {
    let updated: CV | null = null
    renderEditorWithExperienceOpen((cv) => {
      updated = cv
    })
    fireEvent.click(screen.getAllByRole('button', { name: /xoá gạch đầu dòng/i })[0]!)
    expect(updated!.sections.experience[0]!.highlights).toHaveLength(
      initialCVs[0]!.sections.experience[0]!.highlights.length - 1,
    )
  })
})
