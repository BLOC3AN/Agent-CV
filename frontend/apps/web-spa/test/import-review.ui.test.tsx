import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider, useParams } from 'react-router-dom'
import { CVSchema, type CV } from '@hr/schema'
import { ImportReviewRoute, editKindFor } from '../src/routes/ImportReviewRoute.js'
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

/** CV v2 tối giản hợp lệ cho các ca test review. */
function sampleProfile(overrides: Record<string, any> = {}): CV {
  const intro = { fullName: 'Nguyen Van A', ...(overrides.intro ?? {}) }
  const verified = { ...(overrides._meta?.verified ?? {}) }
  const mapItems = (items: any[], kind: string) => items.map((item, i) => {
    const highlights = Array.isArray(item.highlights) ? item.highlights : []
    if (kind === 'experience') return { id: `${kind}-${i}`, title: item.title ?? '', company: item.company ?? '', startDate: item.startDate ?? '', endDate: item.endDate ?? '', current: item.current ?? false, highlights }
    if (kind === 'project') return { id: `${kind}-${i}`, name: item.name ?? '', role: item.role ?? '', startDate: item.startDate ?? '', endDate: item.endDate ?? '', highlights }
    if (kind === 'education') return { id: `${kind}-${i}`, school: item.school ?? '', degree: item.degree ?? '', fieldOfStudy: item.fieldOfStudy ?? '', startDate: item.startDate ?? '', endDate: item.endDate ?? '', highlights }
    if (kind === 'activity') return { id: `${kind}-${i}`, organization: item.organization ?? '', role: item.role ?? '', startDate: item.startDate ?? '', endDate: item.endDate ?? '', highlights }
    if (kind === 'certification') return { id: `${kind}-${i}`, name: item.name ?? '', issuer: item.issuer ?? '', date: item.date ?? '' }
    return { id: `${kind}-${i}`, language: item.language ?? '', proficiency: item.proficiency ?? '' }
  })
  return CVSchema.parse({
    schemaVersion: 2, id: 'cv-1', title: 'CV test', lastModified: new Date().toISOString(), language: 'vi',
    sections: {
      intro: { fullName: intro.fullName, title: intro.title ?? '', email: intro.email ?? '', phone: intro.phone ?? '', location: intro.location ?? '', summary: intro.summary ?? '', website: intro.website, avatarUrl: intro.avatarUrl },
      education: mapItems(overrides.education ?? [], 'education'),
      experience: mapItems(overrides.experience ?? [], 'experience'),
      projects: mapItems(overrides.projects ?? [], 'project'),
      skills: (overrides.skills ?? []).map((item: any, i: number) => typeof item === 'string' ? { id: `skills-${i}`, category: 'Skills', skills: [item] } : item),
      activities: mapItems(overrides.activities ?? [], 'activity'),
      certifications: mapItems(overrides.certifications ?? [], 'certification'),
      languages: mapItems(overrides.languages ?? [], 'language'),
    },
    _meta: { source: 'pdf_import', verified },
  })
}

/**
 * Dựng response giống hệt `reviewContract` phía Go (server.go) — dùng lại
 * `buildReviewItems`/`reviewProgress` thật của `@hr/schema` thay vì tự tính
 * tay, để test không lệch khỏi ngữ nghĩa mà production code phải đọc đúng.
 */
function reviewFor(profile: CV, profileId = 'profile-1'): ImportReviewReady {
  const sections = profile.sections
  const paths = ['/sections/intro', ...sections.education.map((_, i) => `/sections/education/${i}`), ...sections.experience.map((_, i) => `/sections/experience/${i}`), ...sections.projects.map((_, i) => `/sections/projects/${i}`), ...sections.activities.map((_, i) => `/sections/activities/${i}`), ...sections.certifications.map((_, i) => `/sections/certifications/${i}`)]
  if (sections.skills.length) paths.push('/sections/skills')
  if (sections.languages.length) paths.push('/sections/languages')
  const verified = (profile._meta as any)?.verified ?? {}
  const pending = paths.filter((path) => verified[path] !== true)
  const progress = { done: paths.length - pending.length, total: paths.length, complete: pending.length === 0, pending }
  const items = paths.map((path) => ({ kind: 'test', path, title: path }))
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
    expect(confirmButtons).toHaveLength(2) // /sections/intro + /sections/education/0, không mục nào tick sẵn
    expect(screen.getByText(/còn 2 mục chưa xác nhận/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /hoàn tất/i })).toBeDisabled()
  })

  it('chưa xác nhận hết thì không sang được builder', async () => {
    const profile = sampleProfile({
      education: [{ school: 'Bách Khoa', degree: 'Kỹ sư', highlights: [] }],
      _meta: { verified: { '/sections/education/0': true }, source: 'pdf_import' },
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
    const firstReview = reviewFor(profile) // chỉ có /sections/intro, progress.complete=false
    const verifiedProfile = sampleProfile({
      _meta: { verified: { '/sections/intro': true }, source: 'pdf_import' },
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

    expect(verifyProfile).toHaveBeenCalledWith(firstReview.profileId, ['/sections/intro'])

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
    const profile = sampleProfile({ intro: { fullName: 'Nguyen Van A (may doc sai)' } })
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
      expect.arrayContaining([{ op: 'add', path: '/sections/intro/fullName', value: 'Nguyễn Văn A' }]),
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

  // --- Fix vòng 1: 3 Important + 3 Minor từ review ---

  it('Hoàn tất vẫn khoá nếu server nói progress.complete=false, dù client tự đếm ra 0 mục pending (Finding 1)', async () => {
    // `buildReviewItems` (client) và `reviewContract` (server, Go) là HAI cài
    // đặt độc lập của cùng một hợp đồng — mô phỏng trường hợp chúng LỆCH
    // NHAU: progress.pending rỗng (client sẽ đếm ra 0 mục pending) nhưng
    // progress.complete vẫn false. Nếu canFinish chỉ đọc pendingCount tự đối
    // chiếu mà bỏ qua progress.complete, nút sẽ mở khoá sai ở đây.
    const profile = sampleProfile()
    const drifted = { ...reviewFor(profile), progress: { done: 1, total: 1, complete: false, pending: [] } }
    const getImportReview = vi.fn(async () => drifted)

    renderReview({
      getImportReview,
      patchProfile: vi.fn(),
      verifyProfile: vi.fn(),
      completeImport: vi.fn(),
    })

    // pending: [] rỗng khiến mục intro hiện "Đã xác nhận" (client tin server
    // không còn gì pending) — nhưng progress.complete vẫn false, nên đây
    // chính xác là ca cần Hoàn tất khoá dù client không đếm ra mục nào pending.
    await screen.findByTestId('review-item-/sections/intro')
    expect(screen.getByRole('button', { name: /hoàn tất/i })).toBeDisabled()
  })

  it('Hoàn tất vẫn khoá nếu client dựng ra một mục mà server không biết tới (chiều lệch còn lại của Finding 1, review vòng 2)', async () => {
    // Chiều NGƯỢC của test trên: client build 2 mục (intro, education/0),
    // cả hai đều "đã xác nhận" theo _meta.verified — nhưng server chỉ đếm
    // được 1 mục (progress.total=1). Server không hề biết tới mục thứ hai,
    // nên path của nó không nằm trong progress.pending — riêng lẻ mục đó vẫn
    // hiện "Đã xác nhận" (đây là giới hạn đã biết, không sửa ở đây), nhưng
    // Hoàn tất phải khoá vì TỔNG số mục hai bên đếm được khác nhau.
    const profile = sampleProfile({
      education: [{ school: 'Bách Khoa', degree: 'Kỹ sư', highlights: [] }],
      _meta: { verified: { '/sections/intro': true, '/sections/education/0': true }, source: 'pdf_import' },
    })
    const review = reviewFor(profile) // items.length=2, nhưng ta giả lập server chỉ biết 1
    const drifted = { ...review, progress: { done: 1, total: 1, complete: true, pending: [] } }
    const getImportReview = vi.fn(async () => drifted)

    renderReview({
      getImportReview,
      patchProfile: vi.fn(),
      verifyProfile: vi.fn(),
      completeImport: vi.fn(),
    })

    await screen.findByTestId('review-item-/sections/education/0')
    // Xoá điều kiện so khớp `progress.total === items.length` khỏi canFinish
    // làm assertion này đỏ: pendingCount sẽ tính ra 0 (cả hai mục đều "đã xác
    // nhận" theo pending=[]) và progress.complete=true, nên nút sẽ mở nhầm.
    expect(screen.getByRole('button', { name: /hoàn tất/i })).toBeDisabled()
  })

  it('hiện các field KHÔNG nằm trong danh sách hiển thị của mục — kể cả PII — trước khi user bấm Đúng rồi (Finding 2)', async () => {
    // `buildReviewItems` hiển thị avatarUrl trước khi xác nhận mục intro.
    const longPhoto = 'data:image/png;base64,' + 'A'.repeat(200)
    const profile = sampleProfile({
      intro: { fullName: 'Nguyen Van A', avatarUrl: longPhoto },
    })

    renderReview({
      getImportReview: vi.fn(async () => reviewFor(profile)),
      patchProfile: vi.fn(),
      verifyProfile: vi.fn(),
      completeImport: vi.fn(),
    })

    const introItem = await screen.findByTestId('review-item-/sections/intro')
    expect(within(introItem).getByText('Có ảnh đính kèm')).toBeInTheDocument()
    // Ảnh dài không được in nguyên văn (phá bố cục) — chỉ báo có/không.
    expect(within(introItem).queryByText(longPhoto)).not.toBeInTheDocument()
  })

  it('sửa "Mô tả" (highlights) nhiều dòng rồi xác nhận thì gửi đi MẢNG đã sửa, không phải chuỗi nối dấu phẩy (Finding 3)', async () => {
    // review.ts nối highlights bằng ", " chỉ để HIỂN THỊ — patch lại phải là
    // mảng thật, nguồn từ profile thô, không phải tách ngược chuỗi đã nối.
    const profile = sampleProfile({
      experience: [{ company: 'Cty A', title: 'Dev', highlights: ['Dòng gốc 1', 'Dòng gốc 2'] }],
    })
    const review = reviewFor(profile)
    const getImportReview = vi.fn(async () => review)
    const patchProfile = vi.fn(
      async (): Promise<PatchProfileResult> => ({ profile, revisionId: 1, applied: 1, rejected: [] }),
    )
    const verifyProfile = vi.fn(
      async (): Promise<VerifyProfileResult> => ({ profile, progress: { complete: true } }),
    )

    renderReview({ getImportReview, patchProfile, verifyProfile, completeImport: vi.fn() })

    const highlightsInput = await screen.findByLabelText('Mô tả')
    fireEvent.change(highlightsInput, { target: { value: 'Sửa dòng 1\nSửa dòng 2, có dấu phẩy' } })

    // Hồ sơ có intro và experience/0 nên có HAI nút "Đúng rồi" — bấm đúng
    // nút của mục chứa field vừa sửa.
    const workItem = screen.getByTestId('review-item-/sections/experience/0')
    const confirmBtn = within(workItem).getByRole('button', { name: /đúng rồi/i })
    await userEvent.click(confirmBtn)

    await waitFor(() => expect(verifyProfile).toHaveBeenCalled())
    expect(patchProfile).toHaveBeenCalledWith(
      review.profileId,
      expect.arrayContaining([
        { op: 'add', path: '/sections/experience/0/highlights', value: ['Sửa dòng 1', 'Sửa dòng 2, có dấu phẩy'] },
      ]),
    )
  })

  it('field mảng mang giá trị null (worker parse thật sinh ra khi mục không có gạch đầu dòng) vẫn sửa được như một mảng, không phải ô nhập một dòng (Finding 7, review vòng 2)', async () => {
    // parseActivities/parseEducation (backend/cmd/worker/main.go) gán một
    // slice nil khi mục không có highlight nào — Go marshal `nil []any`
    // thành JSON `null`, không phải `[]`. Đây là dữ liệu THẬT, không phải ca
    // dựng. Nếu toProfile không tự chuẩn hoá null → [] TRƯỚC khi
    // buildReviewItems/editKindFor nhìn thấy nó, field này sẽ render thành
    // ô nhập một dòng — sửa rồi xác nhận sẽ gửi một CHUỖI đè lên field
    // z.array(z.string()), và patchProfile (server.go) áp patch không kiểm
    // lại schema nên chuỗi sai kiểu đó được lưu thẳng.
    const profile = sampleProfile({
      activities: [{ name: 'CLB Kỹ năng', role: 'Thành viên', highlights: null as unknown as string[] }],
    })
    const review = reviewFor(profile)
    const getImportReview = vi.fn(async () => review)
    const patchProfile = vi.fn(
      async (): Promise<PatchProfileResult> => ({ profile, revisionId: 1, applied: 1, rejected: [] }),
    )
    const verifyProfile = vi.fn(
      async (): Promise<VerifyProfileResult> => ({ profile, progress: { complete: true } }),
    )

    renderReview({ getImportReview, patchProfile, verifyProfile, completeImport: vi.fn() })

    // Nếu editKindFor thấy `null` (chưa được chuẩn hoá thành mảng), field này
    // render thành <input> và findByLabelText vẫn "thấy" nó — phải kiểm rõ nó
    // là MỘT VÙNG NHIỀU DÒNG (textarea/multiline), không phải input một dòng,
    // để test này thật sự phân biệt hai nhánh của editKindFor.
    const highlightsField = await screen.findByLabelText('Mô tả')
    expect(highlightsField.tagName).toBe('TEXTAREA')

    fireEvent.change(highlightsField, { target: { value: 'Tổ chức sự kiện' } })

    const activityItem = screen.getByTestId('review-item-/sections/activities/0')
    const confirmBtn = within(activityItem).getByRole('button', { name: /đúng rồi/i })
    await userEvent.click(confirmBtn)

    await waitFor(() => expect(verifyProfile).toHaveBeenCalled())
    // Đích: op mang giá trị MẢNG. Xoá `arrayOrEmpty` khỏi `toProfile` (hoặc bỏ
    // áp nó cho activities[].highlights) làm assertion này đỏ, vì lúc đó
    // value sẽ là chuỗi "Tổ chức sự kiện" thay vì mảng một phần tử.
    expect(patchProfile).toHaveBeenCalledWith(
      review.profileId,
      expect.arrayContaining([{ op: 'add', path: '/sections/activities/0/highlights', value: ['Tổ chức sự kiện'] }]),
    )
  })

  it('editKindFor suy cách sửa từ HÌNH DẠNG thật của giá trị, không phải một danh sách hậu tố cố định (Minor 1)', () => {
    // Trước bản vá: một denylist hậu tố (`endsWith('/highlights')`, …) canh
    // theo field list của review.ts — package khác. Thêm field mảng-object
    // mới ở đó mà quên cập nhật denylist thì màn hình PATCH chuỗi đè lên mảng.
    // Suy từ hình dạng thì không còn danh sách nào để quên cập nhật.
    expect(editKindFor('một chuỗi bất kỳ')).toBe('text')
    expect(editKindFor(undefined)).toBe('text')
    expect(editKindFor(['Dòng 1', 'Dòng 2'])).toBe('list')
    expect(editKindFor([])).toBe('list')
    expect(editKindFor([{ label: 'GitHub', url: 'https://x' }])).toBe('readonly')
    expect(editKindFor([{ category: 'Language', skills: ['Python'] }])).toBe('readonly')
  })

  it('lưu xác nhận thành công nhưng tải lại tiến độ hỏng thì KHÔNG báo "lưu thất bại" — báo đúng lỗi tải lại, Hoàn tất vẫn khoá (Minor 3)', async () => {
    const profile = sampleProfile()
    const review = reviewFor(profile) // chỉ intro, đang pending
    const getImportReview = vi
      .fn<(jobId: string) => Promise<ImportReview>>()
      .mockResolvedValueOnce(review) // tải ban đầu
      .mockRejectedValueOnce(new ApiError(500, 'Mất kết nối khi tải lại tiến độ'))
    const verifyProfile = vi.fn(
      async (): Promise<VerifyProfileResult> => ({ profile, progress: { complete: true } }),
    )

    renderReview({ getImportReview, patchProfile: vi.fn(), verifyProfile, completeImport: vi.fn() })

    const confirmBtn = await screen.findByRole('button', { name: /đúng rồi/i })
    await userEvent.click(confirmBtn)

    await waitFor(() => expect(verifyProfile).toHaveBeenCalled())
    // Mục hiện đã xác nhận (lạc quan cục bộ) dù chưa tải lại được progress mới.
    expect(await screen.findByRole('button', { name: /đã xác nhận/i })).toBeInTheDocument()
    // Lỗi tải lại phải xuất hiện dưới dạng banner CÓ NÚT "Tải lại tiến độ" —
    // đúng nhánh `refreshError`. Nếu code gộp nhầm lỗi refetch vào
    // `itemErrors` của riêng mục đó (mất phân biệt "lưu" vs "tải lại"), nút
    // này sẽ không xuất hiện dù message text có thể trùng nhau ở cả hai chỗ.
    expect(await screen.findByRole('button', { name: /tải lại tiến độ/i })).toBeInTheDocument()
    // Và bên trong CHÍNH mục intro không được có lỗi riêng — patch+verify
    // của nó đã thành công thật, "lưu thất bại" là sai sự thật ở đây.
    const introItem = screen.getByTestId('review-item-/sections/intro')
    expect(within(introItem).queryByText(/mất kết nối|không lưu được xác nhận/i)).not.toBeInTheDocument()
    // Hoàn tất vẫn khoá vì progress của server (nguồn xác thực duy nhất cho
    // canFinish) chưa cập nhật được.
    expect(screen.getByRole('button', { name: /hoàn tất/i })).toBeDisabled()
  })
})
