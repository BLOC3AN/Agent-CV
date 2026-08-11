import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { BuilderRoute } from '../src/routes/BuilderRoute'
import { Header } from '../src/components/Header'
import { BuilderLocaleProvider } from '../src/lib/i18n'
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
    { path: '/builder/:cvId', element: <BuilderLocaleProvider><Header /><BuilderRoute /></BuilderLocaleProvider> },
    { path: '/other', element: <BuilderLocaleProvider><Header /><div data-testid="other" /></BuilderLocaleProvider> },
  ], { initialEntries: ['/builder/cv-1'] })
  render(<RouterProvider router={router} />)
  return router
}

const selector = () => screen.getByRole('combobox', { name: /ngôn ngữ cv|cv language/i })

describe('bộ chọn ngôn ngữ CV', () => {
  it('hiện cạnh nút Xem trước khi đang mở một CV', async () => {
    renderBuilder()
    await screen.findByTestId('cv-editor')

    expect(selector()).toBeTruthy()
  })

  it('không hiện ngoài trình sửa', async () => {
    const router = renderBuilder()
    await screen.findByTestId('cv-editor')

    await router.navigate('/other')

    await waitFor(() => expect(screen.getByTestId('other')).toBeTruthy())
    expect(screen.queryByRole('combobox', { name: /ngôn ngữ cv|cv language/i })).toBeNull()
  })

  /*
   * `cv.language` là nguồn sự thật. Tuỳ chọn giao diện trong localStorage KHÔNG
   * được lấn át nó, nếu không sẽ có hai trạng thái để trôi lệch nhau.
   */
  it('mở CV tiếng Anh thì hiện English dù localStorage đang vi', async () => {
    localStorage.setItem('hr-locale', 'vi')
    renderBuilder('en')
    await screen.findByTestId('cv-editor')

    expect((selector() as HTMLSelectElement).value).toBe('en')
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
