import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, createMemoryRouter, RouterProvider } from 'react-router-dom'
import { DashboardRoute } from '../src/routes/DashboardRoute'
import { MyCVsRoute } from '../src/routes/MyCVsRoute'
import { Sidebar } from '../src/components/Sidebar'
import { greetingKey } from '../src/components/DashboardView'
import { cvCompleteness } from '../src/lib/cv-completeness'
import { errorText, jobErrorText } from '../src/lib/error-messages'
import { ApiError } from '../src/lib/api'
import { en } from '../src/lib/i18n/messages.en'
import type { MessageKey } from '../src/lib/i18n'
import type { CV } from '../src/types'
import { LocaleProvider, BuilderLocaleProvider } from '../src/lib/i18n'
import { vietnameseIn, vietnameseLabelsIn } from './helpers/vietnamese'
import * as api from '../src/lib/api'
import { SettingsRoute } from '../src/routes/SettingsRoute'
import { AnalyzeRoute } from '../src/routes/AnalyzeRoute'
import { TemplatesView } from '../src/components/TemplatesView'
import { KBRoute } from '../src/routes/KBRoute'
import { LoginPage } from '../src/routes/LoginPage'
import { NewCVRoute } from '../src/routes/NewCVRoute'
import { UploadModal } from '../src/components/UploadModal'
import { ShareModal } from '../src/components/ShareModal'
import { ImportRoute } from '../src/routes/ImportRoute'
import { GuidedRoute } from '../src/routes/GuidedRoute'
import { ImportReviewRoute } from '../src/routes/ImportReviewRoute'
import { ChatPanel } from '../src/components/ChatPanel'

/** Fixture toàn tiếng Anh, nên mọi dấu tiếng Việt còn lại đều là chữ giao diện. */
const summary = { id: 'cv-1', title: 'Resume', updatedAt: '2026-08-10T09:00:00Z' }
const profileSnapshot = {
  id: 'cv-1', title: 'Resume', lastModified: '2026-08-10', language: 'en',
  sections: { intro: { fullName: 'Alex Tran', title: 'Engineer' }, experience: [], projects: [], education: [], skills: [], activities: [], certifications: [], languages: [] },
  design: { template: 'modern', accentColor: '#000', font: 'Roboto', fontSize: 14, spacing: 'normal' },
  activeSections: { intro: true, experience: true, projects: true, education: true, skills: true, activities: true, certifications: true, languages: true },
} as never

beforeEach(() => localStorage.setItem('hr-locale', 'en'))
afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })

function renderInEnglish(node: React.ReactNode) {
  return render(
    <LocaleProvider>
      <BuilderLocaleProvider>
        <MemoryRouter>{node}</MemoryRouter>
      </BuilderLocaleProvider>
    </LocaleProvider>,
  )
}

describe('giao diện tiếng Anh — ngoài trình sửa', () => {
  it('thanh điều hướng bên trái không còn tiếng Việt', () => {
    const { container } = renderInEnglish(<Sidebar />)

    expect(vietnameseIn(container)).toEqual([])
    expect(vietnameseLabelsIn(container)).toEqual([])
  })

  it('trang tổng quan không còn tiếng Việt', async () => {
    vi.spyOn(api, 'listCVs').mockResolvedValue([summary])
    vi.spyOn(api, 'getCV').mockResolvedValue({ id: 'cv-1', profileId: 'p1', profileSnapshot } as never)
    const { container } = renderInEnglish(<DashboardRoute />)
    await screen.findByText('Alex Tran')

    expect(vietnameseIn(container)).toEqual([])
    expect(vietnameseLabelsIn(container)).toEqual([])
  })

  it('trang tổng quan khi chưa có CV nào cũng không còn tiếng Việt', async () => {
    vi.spyOn(api, 'listCVs').mockResolvedValue([])
    const { container } = renderInEnglish(<DashboardRoute />)
    await screen.findByText('0%')

    expect(vietnameseIn(container)).toEqual([])
  })

  it('danh sách CV không còn tiếng Việt', async () => {
    vi.spyOn(api, 'listCVs').mockResolvedValue([summary])
    const { container } = renderInEnglish(<MyCVsRoute />)
    await screen.findByText('Resume')

    expect(vietnameseIn(container)).toEqual([])
    expect(vietnameseLabelsIn(container)).toEqual([])
  })
})

describe('giao diện tiếng Anh — các màn hình còn lại', () => {
  it('cài đặt không còn tiếng Việt', async () => {
    const { container } = renderInEnglish(<SettingsRoute />)
    await screen.findByRole('heading', { level: 1 })

    expect(vietnameseIn(container)).toEqual([])
    expect(vietnameseLabelsIn(container)).toEqual([])
  })

  it('đối chiếu việc làm không còn tiếng Việt', async () => {
    vi.spyOn(api, 'listCVs').mockResolvedValue([summary])
    const { container } = renderInEnglish(<AnalyzeRoute />)
    await screen.findByRole('button', { name: /phân tích|analyse|analyze/i })

    expect(vietnameseIn(container)).toEqual([])
    expect(vietnameseLabelsIn(container)).toEqual([])
  })

  it('mẫu CV không còn tiếng Việt', () => {
    const { container } = renderInEnglish(<TemplatesView cvs={[]} />)

    expect(vietnameseIn(container)).toEqual([])
  })

  it('kho tri thức không còn tiếng Việt', async () => {
    vi.spyOn(api, 'listKBSources').mockResolvedValue([])
    const { container } = renderInEnglish(<KBRoute />)
    await screen.findByRole('heading', { level: 1 })

    expect(vietnameseIn(container)).toEqual([])
  })

  it('đăng nhập không còn tiếng Việt', () => {
    const { container } = renderInEnglish(<LoginPage />)

    expect(vietnameseIn(container)).toEqual([])
    expect(vietnameseLabelsIn(container)).toEqual([])
  })

  it('tạo CV mới không còn tiếng Việt', () => {
    const { container } = renderInEnglish(<NewCVRoute createCV={async () => ({ id: 'cv-2' } as never)} />)

    expect(vietnameseIn(container)).toEqual([])
    expect(vietnameseLabelsIn(container)).toEqual([])
  })

  it('hộp thoại tải CV lên không còn tiếng Việt', () => {
    const { container } = renderInEnglish(<UploadModal isOpen onClose={() => undefined} onUploadSuccess={() => undefined} />)

    expect(vietnameseIn(container)).toEqual([])
    expect(vietnameseLabelsIn(container)).toEqual([])
  })

  it('hộp thoại chia sẻ không còn tiếng Việt', () => {
    const { container } = renderInEnglish(<ShareModal isOpen onClose={() => undefined} cvTitle="Resume" />)

    expect(vietnameseIn(container)).toEqual([])
  })
})

describe('giao diện tiếng Anh — luồng import và trợ lý', () => {
  it('màn tải CV lên không còn tiếng Việt', async () => {
    const { container } = renderInEnglish(
      <ImportRoute uploadCV={async () => ({ jobId: 'job-1' } as never)} getJob={async () => ({ id: 'job-1', status: 'queued' } as never)} />,
    )
    await screen.findByTestId('import-file-input')

    expect(vietnameseIn(container)).toEqual([])
    expect(vietnameseLabelsIn(container)).toEqual([])
  })

  it('khởi tạo có hướng dẫn không còn tiếng Việt', async () => {
    const { container } = renderInEnglish(<GuidedRoute />)
    await screen.findByRole('heading', { level: 1 })

    expect(vietnameseIn(container)).toEqual([])
    expect(vietnameseLabelsIn(container)).toEqual([])
  })
})

describe('giao diện tiếng Anh — rà soát import và trợ lý AI', () => {
  it('màn rà soát import không còn tiếng Việt', async () => {
    // Route đọc `jobId` từ URL và phân biệt `ready`, nên phải dựng đúng đường
    // dẫn chứ không bọc trần trong MemoryRouter.
    const review = {
      ready: true,
      jobId: 'job-1',
      profileId: 'profile-1',
      profile: {
        schemaVersion: 2, id: 'cv-1', title: 'Resume', lastModified: '2026-08-10T00:00:00Z', language: 'en',
        // Mỗi loại mục PHẢI có ít nhất một phần tử: lưới chỉ bắt được chuỗi nào
        // thực sự render ra, nên fixture rỗng từng giấu nguyên bộ nhãn field.
        sections: {
          intro: { fullName: 'Alex Tran', title: 'Engineer', email: 'alex@example.com', phone: '0900', location: 'Hanoi', summary: 'Builds systems' },
          education: [{ id: 'education-0', school: 'University', degree: 'BSc', fieldOfStudy: 'CS', startDate: '2020', endDate: '2024', gpa: '3.9', highlights: [] }],
          experience: [{ id: 'experience-0', title: 'Lead', company: 'Acme', startDate: '2024', endDate: '2025', current: false, highlights: ['Shipped'] }],
          projects: [{ id: 'projects-0', name: 'Platform', role: 'Lead', startDate: '2024', endDate: '2025', highlights: ['Built it'] }],
          skills: [{ id: 'skills-0', category: 'Backend', skills: ['Go'] }],
          activities: [{ id: 'activities-0', organization: 'Guild', role: 'Mentor', startDate: '2024', endDate: '2025', highlights: ['Coached'] }],
          certifications: [{ id: 'certifications-0', name: 'Cloud Pro', issuer: 'Cloud Org', date: '2025' }],
          languages: [{ id: 'languages-0', language: 'English', proficiency: 'C1' }],
        },
        _meta: { source: 'pdf_import', verified: {} },
      },
      progress: { done: 0, total: 8, complete: false, pending: ['/sections/intro'] },
    } as never
    const router = createMemoryRouter([
      { path: '/import/:jobId/review', element: (
        <ImportReviewRoute
          getImportReview={async () => review}
          patchProfile={async () => ({}) as never}
          verifyProfile={async () => ({}) as never}
          completeImport={async () => ({}) as never}
        />
      ) },
    ], { initialEntries: ['/import/job-1/review'] })
    const { container } = render(
      <LocaleProvider><BuilderLocaleProvider><RouterProvider router={router} /></BuilderLocaleProvider></LocaleProvider>,
    )
    await screen.findByRole('heading', { level: 1 })

    expect(vietnameseIn(container)).toEqual([])
    expect(vietnameseLabelsIn(container)).toEqual([])
  })

  it('trợ lý AI không còn tiếng Việt', async () => {
    const { container } = renderInEnglish(
      <ChatPanel profileId="profile-1" cvId="cv-1" cv={profileSnapshot} layout={undefined as never} draftVersion={0} onApplyAIProposal={() => undefined} onClose={() => undefined} />,
    )
    await screen.findByRole('button', { name: /gửi|send/i })

    expect(vietnameseIn(container)).toEqual([])
    expect(vietnameseLabelsIn(container)).toEqual([])
  })
})

describe('lời chào theo giờ máy người dùng', () => {
  it('chia buổi theo giờ, không cố định một lời chào', () => {
    expect(greetingKey(0)).toBe('greetingMorning')
    expect(greetingKey(11)).toBe('greetingMorning')
    expect(greetingKey(12)).toBe('greetingAfternoon')
    expect(greetingKey(17)).toBe('greetingAfternoon')
    expect(greetingKey(18)).toBe('greetingEvening')
    expect(greetingKey(23)).toBe('greetingEvening')
  })

  it('trang tổng quan dùng lời chào khớp giờ hiện tại của máy', async () => {
    vi.spyOn(api, 'listCVs').mockResolvedValue([])
    renderInEnglish(<DashboardRoute />)
    await screen.findByText('0%')

    const expected = { greetingMorning: 'Good morning,', greetingAfternoon: 'Good afternoon,', greetingEvening: 'Good evening,' }[greetingKey(new Date().getHours())]
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(expected)
  })
})

describe('độ hoàn thiện hồ sơ trên trang tổng quan', () => {
  it('hiện 0% khi chưa có CV nào, không phải một điểm mặc định', async () => {
    vi.spyOn(api, 'listCVs').mockResolvedValue([])
    renderInEnglish(<DashboardRoute />)

    expect(await screen.findByText('0%')).toBeTruthy()
  })

  /*
   * Điểm phải suy từ CV thật. Trước đây chỗ này cứng ở 85% nên mọi hồ sơ —
   * kể cả một CV gần như trống — đều trông như đã đạt chuẩn.
   */
  it('tính điểm từ nội dung CV thật chứ không cố định', async () => {
    const base = profileSnapshot as never as CV
    const sparse = { ...base, sections: { ...base.sections, intro: { fullName: 'Alex Tran', title: '', email: '', phone: '', location: '', summary: '' } } } as CV
    vi.spyOn(api, 'listCVs').mockResolvedValue([summary])
    vi.spyOn(api, 'getCV').mockResolvedValue({ id: 'cv-1', profileId: 'p1', profileSnapshot: sparse } as never)
    renderInEnglish(<DashboardRoute />)
    await screen.findByText('Alex Tran')

    expect(screen.getByText(`${cvCompleteness(sparse)}%`)).toBeTruthy()
    expect(screen.queryByText('85%')).toBeNull()
  })
})

describe('thông báo lỗi và trạng thái theo ngôn ngữ giao diện', () => {
  /*
   * Máy chủ trả câu chữ tiếng Việt cố định kèm một MÃ. Giao diện dịch theo mã;
   * đây là ca người dùng gặp thật: worker Go trả
   * `NO_CV_SECTIONS: Không nhận ra mục CV...`.
   */
  it('dịch lỗi của job theo mã, không hiện nguyên văn tiếng Việt', () => {
    const t = (key: MessageKey) => en[key]

    expect(jobErrorText('NO_CV_SECTIONS: Không nhận ra mục CV như học vấn, kinh nghiệm hoặc kỹ năng', t))
      .toBe(en.errorNoCVSections)
  })

  it('mã lạ thì giữ nguyên văn của máy chủ thay vì nuốt lỗi', () => {
    const t = (key: MessageKey) => en[key]

    expect(jobErrorText('BRAND_NEW_CODE: something went wrong', t)).toBe('BRAND_NEW_CODE: something went wrong')
  })

  it('lỗi API dịch theo mã đã biết', () => {
    const t = (key: MessageKey) => en[key]

    expect(errorText(new ApiError(409, 'raw', 'V2_NOT_BACKFILLED'), t, 'fallback')).toBe(en.errorV2NotBackfilled)
    expect(errorText(new ApiError(500, '', undefined), t, 'fallback')).toBe('fallback')
  })
})
