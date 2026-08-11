import React from 'react'
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router-dom'
import { BuilderRoute } from '../src/routes/BuilderRoute'
import { Header } from '../src/components/Header'
import { BuilderLocaleProvider, LocaleProvider } from '../src/lib/i18n'
import * as api from '../src/lib/api'
import type { CV, CVLayout } from '../src/types'
import { DEFAULT_CV_LAYOUT } from '@hr/schema'

const cv = {
  schemaVersion: 2, id: 'cv-1', language: 'vi',
  title: 'CV',
  lastModified: '',
  sections: {
    intro: { fullName: 'Alex Tran', title: 'Engineer', email: '', phone: '', location: '', summary: 'Summary text' },
    experience: [{ id: 'e1', title: 'Lead', company: 'Acme', startDate: '2024', endDate: '2025', highlights: ['Shipped'] }],
    projects: [], education: [], skills: [], activities: [], certifications: [], languages: [],
  },
  design: { template: 'modern', accentColor: '#000', font: 'Roboto', fontSize: 14, spacing: 'normal' },
  activeSections: { intro: true, experience: true, projects: true, education: true, skills: true, activities: true, certifications: true, languages: true },
  _meta: { verified: {}, source: 'manual', canonical: {} },
} as CV
const layout = structuredClone(DEFAULT_CV_LAYOUT) as CVLayout
const envelope = (profileSnapshot: CV) => ({ id: 'cv-1', profileId: 'profile-1', layout, profileSnapshot, revisionNumber: 0 } as never)

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

function renderBuilder(language: 'vi' | 'en' = 'vi') {
  vi.spyOn(api, 'getCV').mockResolvedValue(envelope({ ...cv, language }))
  const router = createMemoryRouter([
    { path: '/builder/:cvId', element: <><Header /><BuilderRoute /></> },
    { path: '/other', element: <><Header /><div data-testid="other" /></> },
  ], { initialEntries: ['/builder/cv-1'] })
  // Bọc NGOÀI router, đúng như `routes.tsx`: một provider duy nhất cho cả cây.
  // Bọc trong từng route element sẽ dựng provider mới mỗi màn hình, và React
  // tái dùng instance giữa các route — một hình dạng mà ứng dụng thật không có.
  render(
    <LocaleProvider>
      <BuilderLocaleProvider>
        <RouterProvider router={router} />
      </BuilderLocaleProvider>
    </LocaleProvider>,
  )
  return router
}

const selector = () => screen.getByRole('combobox', { name: /ngôn ngữ cv|cv language/i })

describe('bộ chọn ngôn ngữ CV', () => {
  it('hiện cạnh nút Xem trước khi đang mở một CV', async () => {
    renderBuilder()
    await screen.findByTestId('cv-editor')

    expect(selector()).toBeTruthy()
  })

  /*
   * Nút là nút CHUNG: nó ở lại header khi rời trình sửa, và giữ nguyên lựa chọn
   * vừa đặt — lúc đó nó phản ánh tuỳ chọn giao diện thay vì ngôn ngữ của CV.
   */
  it('vẫn ở lại header khi rời trình sửa', async () => {
    const router = renderBuilder('en')
    await screen.findByTestId('cv-editor')

    await router.navigate('/other')

    await waitFor(() => expect(screen.getByTestId('other')).toBeTruthy())
    expect(selector()).toBeTruthy()
  })

  /*
   * Ngoài trình sửa, nút đổi ngôn ngữ giao diện toàn ứng dụng. Dựng thẳng
   * `Header` thay vì dàn dựng điều hướng: điều cần đo là nút, không phải router.
   */
  it('đổi ngôn ngữ giao diện khi không mở CV nào', async () => {
    render(
      <LocaleProvider>
        <BuilderLocaleProvider>
          <MemoryRouter initialEntries={['/']}><Header /></MemoryRouter>
        </BuilderLocaleProvider>
      </LocaleProvider>,
    )
    expect(screen.getByRole('link', { name: 'Trang chủ' })).toBeTruthy()

    fireEvent.change(selector(), { target: { value: 'en' } })

    expect(screen.getByRole('link', { name: 'Home' })).toBeTruthy()
    expect(localStorage.getItem('hr-locale')).toBe('en')
  })

  /*
   * TUỲ CHỌN CỦA NGƯỜI DÙNG LUÔN THẮNG. Mở một CV tiếng Việt trong khi đang
   * chọn English thì giao diện PHẢI ở nguyên tiếng Anh — kể cả tiêu đề mục
   * trong trang giấy. Bản trước để `cv.language` lấn át, và nó tạo ra đúng
   * tình huống khó hiểu: chọn English ở ngoài, vào trình sửa lại thấy tiếng
   * Việt mà không rõ vì sao.
   */
  it('mở CV tiếng Việt vẫn giữ giao diện tiếng Anh của người dùng', async () => {
    localStorage.setItem('hr-locale', 'en')
    renderBuilder('vi')
    const editor = await screen.findByTestId('cv-editor')

    expect((selector() as HTMLSelectElement).value).toBe('en')
    expect(screen.getByRole('button', { name: /save changes/i })).toBeTruthy()
    expect(within(editor).getByText('WORK EXPERIENCE')).toBeTruthy()
  })

  it('mở CV tiếng Anh khi đang chọn tiếng Việt thì giao diện vẫn tiếng Việt', async () => {
    localStorage.setItem('hr-locale', 'vi')
    renderBuilder('en')
    const editor = await screen.findByTestId('cv-editor')

    expect((selector() as HTMLSelectElement).value).toBe('vi')
    expect(within(editor).getByText('KINH NGHIỆM LÀM VIỆC')).toBeTruthy()
  })

  it('đổi selector thì tiêu đề mục trong trang giấy sang tiếng Anh', async () => {
    renderBuilder()
    const paper = await screen.findByTestId('cv-editor')
    expect(within(paper).getByText('KINH NGHIỆM LÀM VIỆC')).toBeTruthy()

    fireEvent.change(selector(), { target: { value: 'en' } })

    await waitFor(() => expect(within(paper).getByText('WORK EXPERIENCE')).toBeTruthy())
    expect(within(paper).queryByText('KINH NGHIỆM LÀM VIỆC')).toBeNull()
  })

  it('đổi selector thì chữ trên giao diện cũng sang tiếng Anh', async () => {
    renderBuilder()
    await screen.findByTestId('cv-editor')

    fireEvent.change(selector(), { target: { value: 'en' } })

    await waitFor(() => expect(screen.getByRole('button', { name: /^preview$/i })).toBeTruthy())
    expect(screen.getByRole('button', { name: /download pdf/i })).toBeTruthy()
  })

  /* Ngôn ngữ nằm trong CV nên đổi nó là sửa tài liệu — phải lưu mới vào PDF. */
  it('đổi selector làm bản nháp thành chưa lưu', async () => {
    renderBuilder()
    await screen.findByTestId('cv-editor')

    fireEvent.change(selector(), { target: { value: 'en' } })

    await waitFor(() => expect(screen.getByText(/^unsaved$/i)).toBeTruthy())
  })

  it('lưu bản nháp gửi ngôn ngữ mới lên máy chủ', async () => {
    const commit = vi.spyOn(api, 'commitCV').mockResolvedValue({ cv: envelope({ ...cv, language: 'en' }) } as never)
    renderBuilder()
    await screen.findByTestId('cv-editor')

    fireEvent.change(selector(), { target: { value: 'en' } })
    fireEvent.click(await screen.findByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1))
    expect(commit.mock.calls[0]![1]).toMatchObject({ language: 'en' })
  })
})
