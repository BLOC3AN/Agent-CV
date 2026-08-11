import { describe, expect, it, vi, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { BuilderRoute } from '../src/routes/BuilderRoute'
import { Header } from '../src/components/Header'
import * as api from '../src/lib/api'
import * as downloadPdf from '../src/lib/download-pdf'
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
const envelope = (profileSnapshot = cv) => ({ id: 'cv-1', profileId: 'profile-1', layout, profileSnapshot, revisionNumber: 0 } as never)

afterEach(() => vi.restoreAllMocks())

/** happy-dom không cài sẵn `window.print`, nên phải dựng chỗ bám cho spy. */
function spyOnPrint() {
  if (typeof window.print !== 'function') Object.defineProperty(window, 'print', { value: () => undefined, writable: true, configurable: true })
  return vi.spyOn(window, 'print').mockImplementation(() => undefined)
}

function renderBuilder() {
  vi.spyOn(api, 'getCV').mockResolvedValue(envelope())
  const router = createMemoryRouter([
    { path: '/builder/:cvId', element: <><Header /><BuilderRoute /></> },
  ], { initialEntries: ['/builder/cv-1'] })
  render(<RouterProvider router={router} />)
  return router
}

const clickDownload = () => fireEvent.click(screen.getByRole('button', { name: /tải pdf/i }))

async function editName() {
  await screen.findByTestId('cv-editor')
  fireEvent.doubleClick(screen.getByTestId('cv-block-header'))
  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Bản Nháp Chưa Lưu' } })
  fireEvent.click(screen.getByRole('button', { name: 'Cập nhật bản nháp' }))
}

describe('nút "Tải PDF" trong trình sửa', () => {
  it('lấy file PDF từ máy chủ về máy người dùng', async () => {
    const download = vi.spyOn(downloadPdf, 'downloadCVPDF').mockResolvedValue()
    renderBuilder()
    await screen.findByTestId('cv-editor')

    clickDownload()

    await waitFor(() => expect(download).toHaveBeenCalledWith('cv-1'))
  })

  /*
   * `window.print()` chỉ mở hộp thoại in để người dùng tự lưu, và bị nuốt lặng
   * lẽ trong tài liệu bị sandbox. Điều hướng sang trang in thì đá người dùng ra
   * khỏi trình sửa mà vẫn không có file nào. Cả hai đều không phải "tải về".
   */
  it('không in và không điều hướng đi đâu cả', async () => {
    const print = spyOnPrint()
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined)
    vi.spyOn(downloadPdf, 'downloadCVPDF').mockResolvedValue()
    renderBuilder()
    await screen.findByTestId('cv-editor')

    clickDownload()

    expect(print).not.toHaveBeenCalled()
    expect(assign).not.toHaveBeenCalled()
  })

  it('vẫn hỏi rõ phiên bản khi bản nháp chưa lưu, và tải sau khi lưu', async () => {
    const download = vi.spyOn(downloadPdf, 'downloadCVPDF').mockResolvedValue()
    const commit = vi.spyOn(api, 'commitCV').mockResolvedValue({ cv: envelope({ ...cv, sections: { ...cv.sections, intro: { ...cv.sections.intro, fullName: 'Bản Nháp Chưa Lưu' } } }) } as never)
    renderBuilder()
    await editName()

    clickDownload()

    const dialog = screen.getByRole('dialog', { name: /xuất pdf với thay đổi chưa lưu/i })
    expect(download).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: /lưu và tải/i }))

    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(download).toHaveBeenCalledWith('cv-1'))
  })

  it('báo lỗi ngay trong trình sửa khi máy chủ không dựng được PDF', async () => {
    vi.spyOn(downloadPdf, 'downloadCVPDF').mockRejectedValue(new api.ApiError(500, 'Không dựng được PDF'))
    renderBuilder()
    await screen.findByTestId('cv-editor')

    clickDownload()

    expect(await screen.findByRole('alert')).toHaveTextContent(/không dựng được pdf/i)
    expect(screen.getByTestId('cv-editor')).toBeTruthy()
  })

  /*
   * Bề mặt in là bản sao đầy đủ của CV. Gắn nó thường trực vào trình sửa sẽ
   * nhân đôi mọi `data-cv-node-id` và chi phí render sau mỗi phím gõ — một lần
   * thử cách đó đã làm đỏ 19 test.
   */
  it('không gắn bản sao CV nào vào trang trình sửa', async () => {
    renderBuilder()
    await screen.findByTestId('cv-editor')

    expect(document.querySelectorAll('#cv-print-surface')).toHaveLength(0)
    expect(screen.getAllByTestId('cv-block-header')).toHaveLength(1)
  })
})
