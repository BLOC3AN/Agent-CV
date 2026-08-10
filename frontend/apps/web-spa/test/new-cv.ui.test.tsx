import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { CVSchema } from '@hr/schema'
import { NewCVRoute } from '../src/routes/NewCVRoute.js'
import * as api from '../src/lib/api.js'
import type { CreateCVResult } from '../src/lib/api.js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('/cv/new', () => {
  // Ràng buộc từ Task 3: POST /api/cv tạo CV có `data` nhưng chưa có
  // `data_v2`. Mọi GET kèm header v2 lên hàng đó trả 409 V2_NOT_BACKFILLED.
  // Route này chọn phương án (a): gieo data_v2 đồng bộ ngay sau khi tạo,
  // trước khi điều hướng — kiểm bằng cách xác nhận `saveCV` được gọi với một
  // CV khớp đúng CVSchema (parse không ném) trước khi màn "đang mở" hiện ra.
  it('gieo data_v2 ngay sau khi tạo, để CV vừa tạo mở được ngay không đâm vào 409 V2_NOT_BACKFILLED', async () => {
    const created = vi.fn(async () => ({ cvId: 'cv-moi', profileId: 'profile-moi' }))
    const saved = vi.spyOn(api, 'saveCV').mockResolvedValue(undefined)

    render(<NewCVRoute createCV={created} />, { wrapper: MemoryRouter })
    await userEvent.click(screen.getByRole('button', { name: /tạo cv/i }))
    await screen.findByText(/đang mở/i)

    expect(saved).toHaveBeenCalledTimes(1)
    const [id, cv] = saved.mock.calls[0]!
    expect(id).toBe('cv-moi')
    expect(() => CVSchema.parse(cv)).not.toThrow()
  })

  it('tạo CV rỗng rồi chuyển sang builder của chính CV vừa tạo', async () => {
    const created = vi.fn(async () => ({ cvId: 'cv-moi', profileId: 'profile-moi' }))
    vi.spyOn(api, 'saveCV').mockResolvedValue(undefined)

    render(<NewCVRoute createCV={created} />, { wrapper: MemoryRouter })
    await userEvent.click(screen.getByRole('button', { name: /tạo cv/i }))
    expect(created).toHaveBeenCalledOnce()
    await screen.findByText(/đang mở/i)
  })

  it('nút bị khoá trong lúc đang tạo, để không tạo hai CV vì bấm hai lần', async () => {
    const created = vi.fn(() => new Promise<CreateCVResult>(() => {}))
    render(<NewCVRoute createCV={created} />, { wrapper: MemoryRouter })
    const btn = screen.getByRole('button', { name: /tạo cv/i })
    await userEvent.click(btn)
    expect(btn).toBeDisabled()

    // `userEvent.click` trên nút `disabled` không phát sự kiện click — đúng
    // hành vi trình duyệt thật khi người dùng bấm lần hai trong lúc chờ.
    // Nếu bỏ `disabled={busy}` ở production, lời gọi thứ hai này sẽ lọt qua
    // và `created` bị gọi hai lần, test dưới đây sẽ đỏ.
    await userEvent.click(btn)
    expect(created).toHaveBeenCalledTimes(1)
  })

  it('tạo hỏng thì báo lỗi rõ ràng và vẫn cho bấm lại, không phải màn hình trắng', async () => {
    const created = vi.fn(async () => {
      throw new api.ApiError(500, 'Không tạo được CV')
    })

    render(<NewCVRoute createCV={created} />, { wrapper: MemoryRouter })
    await userEvent.click(screen.getByRole('button', { name: /tạo cv/i }))

    expect(await screen.findByText('Không tạo được CV')).toBeInTheDocument()
    const btn = screen.getByRole('button', { name: /tạo cv/i })
    expect(btn).not.toBeDisabled()
  })
})
