import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { MyCVsRoute } from '../src/routes/MyCVsRoute.js'
import * as api from '../src/lib/api.js'

function renderRoute() {
  return render(
    <MemoryRouter>
      <MyCVsRoute />
    </MemoryRouter>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('/cv', () => {
  it('hiện trạng thái đang tải trước khi có dữ liệu', async () => {
    vi.spyOn(api, 'listCVs').mockReturnValue(new Promise(() => {}))
    renderRoute()
    expect(await screen.findByTestId('cv-list-loading')).toBeInTheDocument()
  })

  it('liệt kê CV kèm thời gian tương đối và tên tin tuyển dụng', async () => {
    vi.spyOn(api, 'listCVs').mockResolvedValue([
      {
        id: 'cv-1',
        title: 'CV Backend Fresher',
        updatedAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
        jdTitle: 'Junior Go Developer',
      },
    ])

    renderRoute()

    expect(await screen.findByText('CV Backend Fresher')).toBeInTheDocument()
    expect(screen.getByText(/3 giờ trước/)).toBeInTheDocument()
    expect(screen.getByText('Junior Go Developer')).toBeInTheDocument()
  })

  it('chưa có CV nào thì mời tạo, không hiện danh sách rỗng câm lặng', async () => {
    vi.spyOn(api, 'listCVs').mockResolvedValue([])
    renderRoute()
    expect(await screen.findByText(/chưa có cv nào/i)).toBeInTheDocument()
  })

  it('gọi hỏng thì hiện lỗi kèm nút thử lại', async () => {
    vi.spyOn(api, 'listCVs').mockRejectedValue(new api.ApiError(500, 'Không đọc được danh sách CV'))

    renderRoute()

    expect(await screen.findByText('Không đọc được danh sách CV')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /thử lại/i })).toBeInTheDocument()
  })

  it('xoá phải hỏi xác nhận, và chỉ gọi API sau khi người dùng đồng ý', async () => {
    vi.spyOn(api, 'listCVs').mockResolvedValue([
      { id: 'cv-1', title: 'CV Backend Fresher', updatedAt: new Date().toISOString() },
    ])
    const remove = vi.spyOn(api, 'deleteCV').mockResolvedValue(undefined)

    renderRoute()
    await userEvent.click(await screen.findByRole('button', { name: /^xoá$/i }))
    expect(remove).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /xoá vĩnh viễn/i }))
    expect(remove).toHaveBeenCalledWith('cv-1')
    expect(await screen.findByText(/chưa có cv nào/i)).toBeInTheDocument()
  })

  it('xoá hỏng thì CV vẫn còn trong danh sách và có thông báo lỗi', async () => {
    vi.spyOn(api, 'listCVs').mockResolvedValue([
      { id: 'cv-1', title: 'CV Backend Fresher', updatedAt: new Date().toISOString() },
    ])
    vi.spyOn(api, 'deleteCV').mockRejectedValue(new api.ApiError(403, 'Không có quyền xoá CV này'))

    renderRoute()
    await userEvent.click(await screen.findByRole('button', { name: /^xoá$/i }))
    await userEvent.click(screen.getByRole('button', { name: /xoá vĩnh viễn/i }))

    expect(await screen.findByText('Không có quyền xoá CV này')).toBeInTheDocument()
    expect(screen.getByText('CV Backend Fresher')).toBeInTheDocument()
  })
})
