import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider, useParams } from 'react-router-dom'
import { buildReviewItems, reviewProgress, type Profile } from '@hr/schema'
import { ImportReviewRoute } from '../src/routes/ImportReviewRoute.js'
import { ApiError } from '../src/lib/api.js'
import type {
  ImportReview,
  ImportReviewReady,
  JSONPatchOp,
  PatchProfileResult,
  VerifyProfileResult,
  CompleteImportResult,
} from '../src/lib/api.js'

afterEach(() => {
  vi.restoreAllMocks()
})

/**
 * Đích sau khi hoàn tất (Task 7 điều hướng tới đây) — chỉ cần đọc được
 * `cvId` từ URL để xác nhận route đúng, không dựng lại cả builder thật.
 */
function BuilderStub() {
  const { cvId } = useParams()
  return <div data-testid="builder-stub">Builder của {cvId}</div>
}

interface Props {
  getImportReview: (jobId: string) => Promise<ImportReview>
  patchProfile: (profileId: string, ops: JSONPatchOp[]) => Promise<PatchProfileResult>
  verifyProfile: (profileId: string, paths: string[]) => Promise<VerifyProfileResult>
  completeImport: (jobId: string) => Promise<CompleteImportResult>
}

function renderReview(props: Props, jobId = 'job-1') {
  const router = createMemoryRouter(
    [
      { path: '/import/:jobId/review', element: <ImportReviewRoute {...props} /> },
      { path: '/builder/:cvId', element: <BuilderStub /> },
    ],
    { initialEntries: [`/import/${jobId}/review`] },
  )
  return { ...render(<RouterProvider router={router} />), router }
}

/**
 * Hồ sơ v1 tối giản hợp lệ — không dùng `ProfileSchema.parse` vì production
 * code (`ImportReviewRoute`) CỐ TÌNH không đòi hỏi điều đó (xem `toProfile`
 * trong component: model có thể bỏ sót `basics.name`, đúng lý do màn hình
 * này tồn tại). Test tự tay liệt kê field để độc lập với schema đó.
 */
function sampleProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    schemaVersion: 1,
    language: 'vi',
    basics: { name: 'Nguyen Van A', links: [] },
    education: [],
    work: [],
    projects: [],
    skills: [],
    certifications: [],
    activities: [],
    languages: [],
    _meta: { verified: {}, source: 'pdf_import' },
    ...overrides,
  } as Profile
}

/**
 * Dựng response giống hệt `reviewContract` phía Go (server.go) — dùng lại
 * `buildReviewItems`/`reviewProgress` thật của `@hr/schema` thay vì tự tính
 * tay, để test không lệch khỏi ngữ nghĩa mà production code phải đọc đúng.
 */
function reviewFor(profile: Profile, profileId = 'profile-1'): ImportReviewReady {
  const items = buildReviewItems(profile)
  const progress = reviewProgress(items, profile._meta.verified)
  return {
    ready: true,
    status: 'done',
    profileId,
    profile,
    items: items.map((i) => ({ kind: i.kind, path: i.path, title: i.title })),
    progress,
    quality: { level: 'good', warning: false, reasons: [], pages: 1 },
  }
}

describe('/import/:jobId/review', () => {
  it('mọi mục đều bắt đầu ở trạng thái CHƯA xác nhận', async () => {
    // Nội dung do model trích ra là chưa được xác nhận cho tới khi người dùng
    // nói khác đi. Tick sẵn là phá đúng thứ _meta.verified sinh ra để giữ.
    const profile = sampleProfile({
      education: [{ school: 'Bách Khoa', degree: 'Kỹ sư', highlights: [] }],
    })
    const getImportReview = vi.fn(async () => reviewFor(profile))

    renderReview({
      getImportReview,
      patchProfile: vi.fn(),
      verifyProfile: vi.fn(),
      completeImport: vi.fn(),
    })

    const confirmButtons = await screen.findAllByRole('button', { name: /đúng rồi/i })
    expect(confirmButtons).toHaveLength(2) // /basics + /education/0, không mục nào tick sẵn
    expect(screen.getByText(/còn 2 mục chưa xác nhận/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /hoàn tất/i })).toBeDisabled()
  })

  it('chưa xác nhận hết thì không sang được builder', async () => {
    const profile = sampleProfile({
      education: [{ school: 'Bách Khoa', degree: 'Kỹ sư', highlights: [] }],
      _meta: { verified: { '/education/0': true }, source: 'pdf_import' },
    })
    const completeImport = vi.fn()

    renderReview({
      getImportReview: vi.fn(async () => reviewFor(profile)),
      patchProfile: vi.fn(),
      verifyProfile: vi.fn(),
      completeImport,
    })

    const finishBtn = await screen.findByRole('button', { name: /hoàn tất/i })
    expect(finishBtn).toBeDisabled()
    expect(screen.getByText(/còn 1 mục chưa xác nhận/i)).toBeInTheDocument()

    // Nút bị khoá thì click không phát sự kiện — completeImport không được gọi.
    await userEvent.click(finishBtn)
    expect(completeImport).not.toHaveBeenCalled()
  })

  it('xác nhận hết thì mở khoá và gọi completeImport đúng một lần', async () => {
    const profile = sampleProfile()
    const firstReview = reviewFor(profile) // chỉ có /basics, progress.complete=false
    const verifiedProfile = sampleProfile({
      _meta: { verified: { '/basics': true }, source: 'pdf_import' },
    })
    const secondReview = reviewFor(verifiedProfile, firstReview.profileId)

    const getImportReview = vi
      .fn<(jobId: string) => Promise<ImportReview>>()
      .mockResolvedValueOnce(firstReview)
      .mockResolvedValueOnce(secondReview)
    const verifyProfile = vi.fn(async () => ({ profile: verifiedProfile, progress: { complete: true } }))
    const completeImport = vi.fn(async () => ({ cvId: 'cv-9', created: true }))

    renderReview({ getImportReview, patchProfile: vi.fn(), verifyProfile, completeImport })

    const confirmBtn = await screen.findByRole('button', { name: /đúng rồi/i })
    await userEvent.click(confirmBtn)

    expect(verifyProfile).toHaveBeenCalledWith(firstReview.profileId, ['/basics'])

    // Điều kiện mở khoá đọc lại từ progress mà getImportReview trả về LẦN HAI
    // (gọi lại sau khi xác nhận) — không phải một biến đếm cục bộ.
    const finishBtn = await screen.findByRole('button', { name: /hoàn tất/i })
    await waitFor(() => expect(finishBtn).not.toBeDisabled())

    await userEvent.click(finishBtn)

    await screen.findByTestId('builder-stub')
    expect(completeImport).toHaveBeenCalledTimes(1)
    expect(completeImport).toHaveBeenCalledWith('job-1')
    expect(screen.getByTestId('builder-stub')).toHaveTextContent('cv-9')
  })

  it('sửa nội dung tại chỗ rồi xác nhận thì gửi đi bản ĐÃ SỬA', async () => {
    // Nếu bản gửi đi là bản gốc của model, màn rà soát chỉ là hình thức.
    const profile = sampleProfile({ basics: { name: 'Nguyen Van A (may doc sai)', links: [] } })
    const review = reviewFor(profile)
    const getImportReview = vi.fn(async () => review)
    const patchProfile = vi.fn(
      async (): Promise<PatchProfileResult> => ({ profile, revisionId: 1, applied: 1, rejected: [] }),
    )
    const verifyProfile = vi.fn(
      async (): Promise<VerifyProfileResult> => ({ profile, progress: { complete: true } }),
    )

    renderReview({ getImportReview, patchProfile, verifyProfile, completeImport: vi.fn() })

    const nameInput = await screen.findByLabelText('Họ tên')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'Nguyễn Văn A')

    const confirmBtn = screen.getByRole('button', { name: /đúng rồi/i })
    await userEvent.click(confirmBtn)

    await waitFor(() => expect(verifyProfile).toHaveBeenCalled())
    expect(patchProfile).toHaveBeenCalledWith(
      review.profileId,
      expect.arrayContaining([{ op: 'add', path: '/basics/name', value: 'Nguyễn Văn A' }]),
    )
  })

  it('mở bằng job chưa xử lý xong thì báo trạng thái, không hiện màn duyệt', async () => {
    // Đường vòng qua URL bar hoặc link cũ: job chưa "done" thì chưa có gì để
    // duyệt — không được crash, không được hiện nút Hoàn tất.
    const getImportReview = vi.fn(async (): Promise<ImportReview> => ({ ready: false, status: 'running' }))

    renderReview({
      getImportReview,
      patchProfile: vi.fn(),
      verifyProfile: vi.fn(),
      completeImport: vi.fn(),
    })

    expect(await screen.findByText(/chưa xử lý xong/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /hoàn tất/i })).not.toBeInTheDocument()
  })

  it('tải dữ liệu rà soát hỏng thì báo lỗi và cho thử lại, không phải màn trắng', async () => {
    const getImportReview = vi.fn(async (): Promise<ImportReview> => {
      throw new ApiError(500, 'Không tải được dữ liệu rà soát')
    })

    renderReview({
      getImportReview,
      patchProfile: vi.fn(),
      verifyProfile: vi.fn(),
      completeImport: vi.fn(),
    })

    expect(await screen.findByText('Không tải được dữ liệu rà soát')).toBeInTheDocument()
    const retryBtn = screen.getByRole('button', { name: /thử lại/i })
    await userEvent.click(retryBtn)
    expect(getImportReview).toHaveBeenCalledTimes(2)
  })
})
