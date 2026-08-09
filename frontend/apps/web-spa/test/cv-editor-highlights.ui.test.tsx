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

  /**
   * Khay sửa hiện TẤT CẢ các mục kinh nghiệm cùng lúc — CV mẫu (initialCVs[0])
   * vốn đã có hai mục đều mang bullet (exp-1 với 4 dòng, exp-2 với 2 dòng),
   * đúng tình huống bản sửa lỗi round 1 chỉ ra: nếu tên hỗ trợ tiếp cận chỉ
   * dựa vào chỉ số dòng, hai nút "Thêm gạch đầu dòng" (một cho mỗi mục) sẽ có
   * tên giống hệt nhau, và người dùng đọc màn hình lẫn kiểm thử dựa trên nhãn
   * không còn cách nào phân biệt mục nào đang được thao tác.
   */
  it('nút thêm/xoá của mỗi mục có tên phân biệt, không trộn giữa các mục', () => {
    let updated: CV | null = null
    renderEditorWithExperienceOpen((cv) => {
      updated = cv
    })

    const addButtons = screen.getAllByRole('button', { name: /thêm gạch đầu dòng/i })
    expect(addButtons).toHaveLength(2)
    const addNames = addButtons.map((b) => b.getAttribute('aria-label'))
    expect(new Set(addNames).size).toBe(2)

    const removeButtons = screen.getAllByRole('button', { name: /xoá gạch đầu dòng 1 —/i })
    expect(removeButtons).toHaveLength(2)
    const removeNames = removeButtons.map((b) => b.getAttribute('aria-label'))
    expect(new Set(removeNames).size).toBe(2)

    // Bấm nút "Thêm" của mục THỨ HAI phải nối vào mục thứ hai, không phải mục đầu —
    // đây là phép thử sẽ bắt được một khúc refactor tương lai lỡ đóng sai chỉ số `idx`.
    fireEvent.click(addButtons[1]!)
    expect(updated!.sections.experience[0]!.highlights).toHaveLength(
      initialCVs[0]!.sections.experience[0]!.highlights.length,
    )
    expect(updated!.sections.experience[1]!.highlights).toHaveLength(
      initialCVs[0]!.sections.experience[1]!.highlights.length + 1,
    )
  })
})
