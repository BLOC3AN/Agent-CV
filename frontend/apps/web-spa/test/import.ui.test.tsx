import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider, useParams } from 'react-router-dom'
import { ImportRoute } from '../src/routes/ImportRoute.js'
import { ApiError } from '../src/lib/api.js'
import type { Job, UploadCVResult } from '../src/lib/api.js'

afterEach(() => {
  vi.restoreAllMocks()
})

/**
 * Đích đến sau khi job xong (Task 7 mới dựng thật). Ở đây chỉ cần một màn
 * hình giả đọc được `jobId` từ URL, để xác nhận ImportRoute điều hướng tới
 * đúng job — không phải mở thẳng builder, vì màn duyệt là bắt buộc.
 */
function ReviewStub() {
  const { jobId } = useParams()
  return <div data-testid="review-stub">Đang duyệt job {jobId}</div>
}

function renderImport(props: {
  uploadCV: (file: File) => Promise<UploadCVResult>
  getJob: (id: string) => Promise<Job>
  pollIntervalMs?: number
}) {
  const router = createMemoryRouter(
    [
      { path: '/import', element: <ImportRoute {...props} /> },
      { path: '/import/:jobId/review', element: <ReviewStub /> },
    ],
    { initialEntries: ['/import'] },
  )
  return { ...render(<RouterProvider router={router} />), router }
}

function pdfFile(name = 'cv.pdf') {
  return new File(['%PDF-1.4 nội dung giả lập'], name, { type: 'application/pdf' })
}

function job(overrides: Partial<Job> = {}): Job {
  return { id: 'job-1', kind: 'parse_cv', status: 'queued', createdAt: new Date().toISOString(), ...overrides }
}

describe('/import', () => {
  it('tải file lên rồi hiện tiến độ theo trạng thái job', async () => {
    const uploadCV = vi.fn(async () => ({ jobId: 'job-1', queued: true, uploadId: 'up-1' }))
    const getJob = vi
      .fn<(id: string) => Promise<Job>>()
      .mockResolvedValueOnce(job({ status: 'queued' }))
      .mockResolvedValueOnce(job({ status: 'running' }))
      .mockResolvedValueOnce(job({ status: 'done' }))

    renderImport({ uploadCV, getJob, pollIntervalMs: 5 })

    await userEvent.upload(screen.getByTestId('import-file-input'), pdfFile())

    expect(uploadCV).toHaveBeenCalledWith(expect.objectContaining({ name: 'cv.pdf' }))
    // queued rồi running phải hiện ra theo đúng thứ tự job thật đi qua — không
    // nhảy thẳng lên "done" và cũng không đứng yên ở "queued".
    await screen.findByText(/xếp hàng/i)
    await screen.findByText(/trích xuất/i)

    // Xong việc thì màn hình phải đưa người dùng sang bước duyệt bắt buộc,
    // không phải mở thẳng builder — review là chặng không thể bỏ qua (Task 7).
    const stub = await screen.findByTestId('review-stub')
    expect(stub).toHaveTextContent('job-1')
    expect(getJob).toHaveBeenCalledTimes(3)
  })

  it('job hỏng thì hiện lý do và nút thử lại, không phải màn trắng', async () => {
    const uploadCV = vi.fn(async () => ({ jobId: 'job-1', queued: true, uploadId: 'up-1' }))
    const getJob = vi.fn(async () =>
      job({ status: 'failed', error: 'Không đọc được nội dung file PDF.' }),
    )

    renderImport({ uploadCV, getJob, pollIntervalMs: 5 })
    await userEvent.upload(screen.getByTestId('import-file-input'), pdfFile())

    expect(await screen.findByText('Không đọc được nội dung file PDF.')).toBeInTheDocument()
    const retryBtn = screen.getByRole('button', { name: /thử lại/i })
    expect(retryBtn).toBeInTheDocument()

    // Bấm thử lại phải đưa người dùng về được màn chọn file, không kẹt ở lỗi
    // — đó là "đường đi tiếp" mà UC-71 đòi hỏi, không chỉ là một câu chữ.
    await userEvent.click(retryBtn)
    expect(await screen.findByTestId('import-file-input')).toBeInTheDocument()
  })

  it('dừng hỏi khi rời màn hình — không tiếp tục gọi API vô hạn', async () => {
    const uploadCV = vi.fn(async () => ({ jobId: 'job-1', queued: true, uploadId: 'up-1' }))
    // Job đứng yên ở "running" mãi — mô phỏng người dùng đóng tab/điều hướng
    // đi trong lúc job còn đang chạy. Polling không có điều kiện dừng ở
    // unmount là lỗi chỉ lộ ra sau khi tab mở lâu.
    const getJob = vi.fn(async () => job({ status: 'running' }))

    const { unmount } = renderImport({ uploadCV, getJob, pollIntervalMs: 5 })
    await userEvent.upload(screen.getByTestId('import-file-input'), pdfFile())
    await screen.findByText(/trích xuất/i)

    const callsBeforeUnmount = getJob.mock.calls.length
    unmount()

    // Chờ lâu hơn nhiều lần khoảng hỏi (5ms) để nếu timer còn sống thì chắc
    // chắn đã bắn thêm ít nhất một lần.
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(getJob.mock.calls.length).toBe(callsBeforeUnmount)
  })

  it('tải lên hỏng cũng hiện lỗi kèm đường đi tiếp, không màn trắng', async () => {
    const uploadCV = vi.fn(async () => {
      throw new ApiError(415, 'File không phải PDF')
    })
    const getJob = vi.fn(async () => job({ status: 'queued' }))

    renderImport({ uploadCV, getJob, pollIntervalMs: 5 })
    await userEvent.upload(screen.getByTestId('import-file-input'), pdfFile())

    expect(await screen.findByText('File không phải PDF')).toBeInTheDocument()
    expect(getJob).not.toHaveBeenCalled()
  })
})
