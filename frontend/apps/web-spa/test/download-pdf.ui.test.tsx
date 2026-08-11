import { describe, expect, it, vi, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
const envelope = (profileSnapshot = cv) => ({ id: 'cv-1', profileId: 'profile-1', layout, profileSnapshot, revisionNumber: 0 } as never)

afterEach(() => vi.restoreAllMocks())

/**
 * happy-dom không cài sẵn `window.print`, nên phải dựng chỗ bám cho spy.
 *
 * Bề mặt in chỉ sống trong lúc in, nên mọi khẳng định về nó phải chụp lại NGAY
 * trong lệnh gọi — soi sau khi in xong thì nó đã bị gỡ.
 */
function spyOnPrint() {
  const surfaces: { count: number; text: string }[] = []
  if (typeof window.print !== 'function') Object.defineProperty(window, 'print', { value: () => undefined, writable: true, configurable: true })
  const spy = vi.spyOn(window, 'print').mockImplementation(() => {
    const found = [...document.querySelectorAll<HTMLElement>('#cv-print-surface')]
    surfaces.push({ count: found.length, text: found.map((element) => element.textContent ?? '').join('') })
  })
  return { spy, surfaces }
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
  it('mở hộp thoại in thay vì điều hướng đi nơi khác', async () => {
    const { spy } = spyOnPrint()
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined)
    renderBuilder()
    await screen.findByTestId('cv-editor')

    clickDownload()

    expect(spy).toHaveBeenCalledTimes(1)
    expect(assign).not.toHaveBeenCalled()
  })

  /*
   * Quy tắc in ẩn `body *` rồi chỉ cho `#cv-print-surface` hiện lại. Không có
   * bề mặt đó lúc in thì lệnh in ra giấy trắng — nên đây là một phần của tính
   * năng, không phải chi tiết trang trí.
   */
  it('dựng đúng một bề mặt in, mang nội dung CV đang mở', async () => {
    const { surfaces } = spyOnPrint()
    renderBuilder()
    await screen.findByTestId('cv-editor')

    clickDownload()

    expect(surfaces).toHaveLength(1)
    expect(surfaces[0]!.count).toBe(1)
    expect(surfaces[0]!.text).toContain('A')
  })

  it('gỡ bề mặt in khỏi trang sau khi in xong', async () => {
    spyOnPrint()
    renderBuilder()
    await screen.findByTestId('cv-editor')

    clickDownload()

    expect(document.querySelectorAll('#cv-print-surface')).toHaveLength(0)
    // Bản sao còn sót lại sẽ nhân đôi mọi khối CV trên trang trình sửa.
    expect(screen.getAllByTestId('cv-block-header')).toHaveLength(1)
  })

  it('không dựng bề mặt thứ hai khi popup xem trước đang mở', async () => {
    const { surfaces } = spyOnPrint()
    renderBuilder()
    await screen.findByTestId('cv-editor')
    fireEvent.click(screen.getByRole('button', { name: /xem trước/i }))

    const dialog = screen.getByRole('dialog', { name: /xem trước cv/i })
    fireEvent.click(within(dialog).getByRole('button', { name: /tải pdf/i }))

    expect(surfaces[0]!.count).toBe(1)
  })

  it('vẫn hỏi rõ phiên bản khi bản nháp chưa lưu, và in sau khi lưu', async () => {
    const { spy, surfaces } = spyOnPrint()
    const commit = vi.spyOn(api, 'commitCV').mockResolvedValue({ cv: envelope({ ...cv, sections: { ...cv.sections, intro: { ...cv.sections.intro, fullName: 'Bản Nháp Chưa Lưu' } } }) } as never)
    renderBuilder()
    await editName()

    clickDownload()

    const dialog = screen.getByRole('dialog', { name: /xuất pdf với thay đổi chưa lưu/i })
    expect(spy).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: /lưu và tải/i }))

    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1))
    expect(spy).toHaveBeenCalledTimes(1)
    // Bản in phải mang đúng nội dung vừa lưu, không phải bản trước khi sửa.
    expect(surfaces[0]!.text).toContain('Bản Nháp Chưa Lưu')
  })
})
