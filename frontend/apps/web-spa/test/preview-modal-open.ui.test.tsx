import { describe, expect, it, vi, afterEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { BuilderRoute } from '../src/routes/BuilderRoute'
import { Header } from '../src/components/Header'
import * as api from '../src/lib/api'
import type { CV, CVLayout } from '../src/types'
import { DEFAULT_CV_LAYOUT } from '@hr/schema'

const cv = {
  schemaVersion: 2, id: 'cv-1', language: 'vi',
  title: 'CV',
  lastModified: '',
  sections: { intro: { fullName: 'A', title: '', email: '', phone: '', location: '', summary: '' }, experience: [], projects: [], education: [], skills: [], activities: [], certifications: [], languages: [] },
  design: { template: 'modern', accentColor: '#000', font: 'Roboto', fontSize: 14, spacing: 'normal' },
  activeSections: { intro: true, experience: true, projects: true, education: true, skills: true, activities: true, certifications: true, languages: true },
  _meta: { verified: {}, source: 'manual', canonical: {} },
} as CV
const layout = structuredClone(DEFAULT_CV_LAYOUT) as CVLayout
const envelope = () => ({ id: 'cv-1', profileId: 'profile-1', layout, profileSnapshot: cv, revisionNumber: 0 } as never)

afterEach(() => vi.restoreAllMocks())

function renderBuilder() {
  vi.spyOn(api, 'getCV').mockResolvedValue(envelope())
  const router = createMemoryRouter([
    { path: '/builder/:cvId', element: <><Header /><BuilderRoute /></> },
  ], { initialEntries: ['/builder/cv-1'] })
  render(<RouterProvider router={router} />)
  return router
}

const openPreview = () => fireEvent.click(screen.getByRole('button', { name: /xem trước/i }))

/** Chỉ so nội dung đã render — bỏ chrome riêng của trình sửa (chọn/hover). */
function paperText(paper: HTMLElement): string {
  return [...paper.querySelectorAll<HTMLElement>('[data-cv-node-id]')]
    .map((node) => `${node.dataset.cvNodeId}:${node.textContent?.replace(/\s+/g, ' ').trim()}`)
    .join('\n')
}

/**
 * Markup của trang giấy, đã gỡ những thuộc tính chỉ trình sửa mới gắn
 * (`tabindex`/`role`/`data-cv-selected` do chọn và sửa tại chỗ). Phần còn lại
 * PHẢI trùng khít: đó chính là "nhìn sao render vậy".
 */
function paperMarkup(paper: HTMLElement): string {
  const clone = paper.cloneNode(true) as HTMLElement
  for (const element of clone.querySelectorAll('[tabindex], [role], [data-cv-selected]')) {
    element.removeAttribute('tabindex')
    element.removeAttribute('role')
    element.removeAttribute('data-cv-selected')
  }
  return clone.innerHTML
}

async function editName() {
  await screen.findByTestId('cv-editor')
  fireEvent.doubleClick(screen.getByTestId('cv-block-header'))
  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Nguyễn Văn Bản Nháp' } })
  fireEvent.click(screen.getByRole('button', { name: 'Cập nhật bản nháp' }))
}

describe('nút "Xem trước" trên header trình sửa', () => {
  it('mở popup xem trước ngay tại chỗ', async () => {
    renderBuilder()
    await screen.findByTestId('cv-editor')

    openPreview()

    expect(screen.getByRole('dialog', { name: /xem trước cv/i })).toBeTruthy()
  })

  it('không chặn bởi hộp thoại "Thay đổi chưa lưu"', async () => {
    renderBuilder()
    await editName()

    openPreview()

    expect(screen.queryByRole('dialog', { name: /thay đổi chưa lưu/i })).toBeNull()
    expect(screen.getByRole('dialog', { name: /xem trước cv/i })).toBeTruthy()
  })

  it('hiển thị đúng bản nháp đang sửa, không phải bản đã lưu', async () => {
    renderBuilder()
    await editName()

    openPreview()

    const preview = document.querySelector('#a4-cv-preview-paper') as HTMLElement
    expect(preview).toBeTruthy()
    expect(preview.textContent).toContain('Nguyễn Văn Bản Nháp')
  })

  it('render giống hệt trang giấy trong trình sửa', async () => {
    renderBuilder()
    await editName()

    openPreview()

    const editor = document.querySelector('#a4-cv-paper') as HTMLElement
    const preview = document.querySelector('#a4-cv-preview-paper') as HTMLElement
    expect(paperText(preview)).toEqual(paperText(editor))
    expect(paperMarkup(preview)).toEqual(paperMarkup(editor))
  })

  it('dùng cùng biến kiểu chữ và lề trang với trình sửa', async () => {
    renderBuilder()
    await screen.findByTestId('cv-editor')
    openPreview()

    const editor = document.querySelector('#a4-cv-paper') as HTMLElement
    const preview = document.querySelector('#a4-cv-preview-paper') as HTMLElement
    for (const token of ['--cv-font-family', '--cv-body-size', '--cv-header-size', '--cv-line-height', '--cv-padding-top', '--cv-padding-left', '--cv-text-align']) {
      expect(preview.style.getPropertyValue(token)).toEqual(editor.style.getPropertyValue(token))
    }
  })

  it('đóng popup trả lại trình sửa nguyên trạng', async () => {
    renderBuilder()
    await screen.findByTestId('cv-editor')
    openPreview()

    fireEvent.click(screen.getByRole('button', { name: /đóng xem trước/i }))

    expect(screen.queryByRole('dialog', { name: /xem trước cv/i })).toBeNull()
    expect(screen.getByTestId('cv-editor')).toBeTruthy()
  })
})
