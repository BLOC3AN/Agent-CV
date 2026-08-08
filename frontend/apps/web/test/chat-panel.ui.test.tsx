import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProfileSchema, type Profile } from '@hr/schema'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { resetChat } from '@/lib/chat-store'

/**
 * TC-51-* — khung chat, kiểm ở tầng GIAO DIỆN.
 *
 * Trọng tâm: gợi ý phải dựng từ HỒ SƠ THẬT. Danh sách cứng mời người dùng vào
 * ngõ cụt — chip "Thêm số liệu cho dự án đầu tiên" trên một CV không có mục dự
 * án nào dẫn tới đúng lỗi người dùng đã gặp.
 */

function profile(over: Partial<Profile> = {}): Profile {
  return ProfileSchema.parse({
    schemaVersion: 1,
    language: 'vi',
    basics: { name: 'Nguyễn Văn A' },
    ...over,
  })
}

const render_ = (p: Profile, profileId = 'p-1') =>
  render(<ChatPanel profileId={profileId} profile={p} onProfileChange={vi.fn()} />)

// Phiên chat sống ở store mức module (để giữ qua việc chuyển tab), nên nó cũng
// sống qua các test trong file này. Xoá trước mỗi test.
beforeEach(() => resetChat())

describe('gợi ý dựng từ hồ sơ thật', () => {
  it('CV KHÔNG có dự án → KHÔNG gợi ý sửa dự án', () => {
    render_(profile({ work: [{ org: 'X', role: 'Dev', highlights: ['a'] }] }))
    expect(screen.queryByText(/dự án đầu tiên/i)).not.toBeInTheDocument()
  })

  it('CV CÓ dự án → gợi ý sửa dự án', () => {
    render_(profile({ projects: [{ name: 'Shop', tech: [], highlights: [] }] }))
    expect(screen.getByText(/dự án đầu tiên/i)).toBeInTheDocument()
  })

  it('CV không có kinh nghiệm → không gợi ý làm gọn kinh nghiệm', () => {
    render_(profile({ projects: [{ name: 'P', tech: [], highlights: [] }] }))
    expect(screen.queryByText(/làm gọn mục kinh nghiệm/i)).not.toBeInTheDocument()
  })

  it('CV RỖNG → gợi ý BỔ SUNG, không gợi ý sửa', () => {
    render_(profile())
    expect(screen.getByText(/còn thiếu gì/i)).toBeInTheDocument()
    expect(screen.queryByText(/làm gọn/i)).not.toBeInTheDocument()
  })

  it('nhiều kỹ năng → gợi ý rút gọn', () => {
    render_(profile({ skills: Array.from({ length: 12 }, (_, i) => ({ name: `S${i}` })) }))
    expect(screen.getByText(/rút gọn danh sách kỹ năng/i)).toBeInTheDocument()
  })

  it('tối đa 4 gợi ý — nhiều hơn thành danh sách để đọc, không phải để bấm', () => {
    render_(
      profile({
        work: [{ org: 'X', role: 'D', highlights: ['a'] }],
        projects: [{ name: 'P', tech: [], highlights: [] }],
        basics: { name: 'A', summary: 'Tóm tắt', links: [] },
        skills: Array.from({ length: 12 }, (_, i) => ({ name: `S${i}` })),
      }),
    )
    const list = screen.getByRole('list')
    expect(list.querySelectorAll('li').length).toBeLessThanOrEqual(4)
  })
})

describe('trạng thái chờ', () => {
  it('ô nhập và nút gửi có nhãn cho trình đọc màn hình', () => {
    render_(profile({ work: [{ org: 'X', role: 'D', highlights: [] }] }))
    expect(screen.getByLabelText(/Tin nhắn cho trợ lý/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Gửi' })).toBeInTheDocument()
  })

  it('nút Gửi vô hiệu khi chưa gõ gì', () => {
    render_(profile({ work: [{ org: 'X', role: 'D', highlights: [] }] }))
    expect(screen.getByRole('button', { name: 'Gửi' })).toBeDisabled()
  })
})

/**
 * TC-56-10 — trả lời cho câu HỎI, kèm việc làm tiếp được.
 *
 * Trước đây mọi câu hỏi đều nhận cùng một câu "Mình chưa rõ bạn muốn sửa gì",
 * dù hệ thống đã phân loại đúng là câu hỏi (UC-56, BR-56.1).
 */

/** Giả một luồng SSE gồm vài sự kiện `step` rồi một `result`. */
function sseResponse(events: [string, unknown][]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder()
      for (const [event, data] of events) {
        c.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }
      c.close()
    },
  })
  return { ok: true, body } as unknown as Response
}

describe('UC-56 — hỏi trợ lý', () => {
  it('hiện câu trả lời của trợ lý, không phải câu "chưa rõ bạn muốn sửa gì"', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          ['step', { step: 'answering', label: 'Đang xem lại hồ sơ để trả lời' }],
          [
            'result',
            {
              kind: 'reply',
              text: 'Mục kinh nghiệm chưa có con số nào nên khó hình dung quy mô.',
              nextSteps: [],
            },
          ],
        ]),
      ),
    )
    render_(profile({ work: [{ org: 'X', role: 'D', highlights: ['a'] }] }))

    await user.type(screen.getByLabelText(/Tin nhắn cho trợ lý/), 'Tôi có insight nào không')
    await user.click(screen.getByRole('button', { name: 'Gửi' }))

    expect(await screen.findByText(/chưa có con số nào/)).toBeInTheDocument()
    expect(screen.queryByText(/chưa rõ bạn muốn sửa gì/i)).not.toBeInTheDocument()
  })

  it('việc làm tiếp được hiện thành NÚT bấm được, không phải chữ thường', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async () =>
      sseResponse([
        ['result', { kind: 'reply', text: 'Nhận xét.', nextSteps: ['Làm gọn mục kinh nghiệm'] }],
      ]),
    )
    vi.stubGlobal('fetch', fetchMock)
    render_(profile({ work: [{ org: 'X', role: 'D', highlights: ['a'] }] }))

    await user.type(screen.getByLabelText(/Tin nhắn cho trợ lý/), 'CV tôi yếu chỗ nào')
    await user.click(screen.getByRole('button', { name: 'Gửi' }))

    // In ra dạng chữ thì người dùng phải tự gõ lại y hệt câu đó
    const btn = await screen.findByRole('button', { name: 'Làm gọn mục kinh nghiệm' })
    await user.click(btn)

    // Bấm vào là gửi thành một lượt chat mới
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const body = JSON.parse(
      (fetchMock.mock.calls[1] as unknown as [string, { body: string }])[1].body,
    ) as { message: string }
    expect(body.message).toBe('Làm gọn mục kinh nghiệm')
  })

  it('hội thoại CÒN NGUYÊN sau khi chuyển tab rồi quay lại', async () => {
    /*
     * HỒI QUY: BuilderShell chỉ mount một slide-over, nên bấm "Lịch sử" là
     * ChatPanel unmount. Khi state nằm trong component, mở lại "Trợ lý" thấy
     * hội thoại trắng trơn.
     */
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sseResponse([['result', { kind: 'reply', text: 'Câu trả lời cũ' }]])),
    )
    const p = profile({ work: [{ org: 'X', role: 'D', highlights: ['a'] }] })
    const view = render_(p)

    await user.type(screen.getByLabelText(/Tin nhắn cho trợ lý/), 'câu hỏi thứ nhất')
    await user.click(screen.getByRole('button', { name: 'Gửi' }))
    expect(await screen.findByText('Câu trả lời cũ')).toBeInTheDocument()

    // Sang tab Lịch sử → ChatPanel bị unmount
    view.unmount()
    // Quay lại tab Trợ lý
    render_(p)

    expect(screen.getByText('câu hỏi thứ nhất')).toBeInTheDocument()
    expect(screen.getByText('Câu trả lời cũ')).toBeInTheDocument()
  })

  it('đổi sang hồ sơ KHÁC thì bắt đầu hội thoại mới', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sseResponse([['result', { kind: 'reply', text: 'Trả lời hồ sơ 1' }]])),
    )
    const p = profile({ work: [{ org: 'X', role: 'D', highlights: ['a'] }] })
    const view = render_(p, 'p-1')

    await user.type(screen.getByLabelText(/Tin nhắn cho trợ lý/), 'hỏi về hồ sơ 1')
    await user.click(screen.getByRole('button', { name: 'Gửi' }))
    expect(await screen.findByText('Trả lời hồ sơ 1')).toBeInTheDocument()

    view.unmount()
    render_(p, 'p-2')

    expect(screen.queryByText('hỏi về hồ sơ 1')).not.toBeInTheDocument()
  })

  it('câu trả lời về ĐÚNG chỗ dù người dùng chuyển tab lúc đang chờ', async () => {
    /*
     * Lượt chat mất 20–60s và người dùng hay bấm sang tab khác trong lúc chờ.
     * `send` nằm ở store nên kết quả vẫn được ghi lại, không rơi vào một
     * component đã chết.
     */
    const user = userEvent.setup()
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const body = new ReadableStream<Uint8Array>({
          async start(c) {
            const enc = new TextEncoder()
            await gate
            c.enqueue(
              enc.encode(
                `event: result\ndata: ${JSON.stringify({ kind: 'reply', text: 'trả lời muộn' })}\n\n`,
              ),
            )
            c.close()
          },
        })
        return { ok: true, body } as unknown as Response
      }),
    )
    const p = profile({ work: [{ org: 'X', role: 'D', highlights: ['a'] }] })
    const view = render_(p)

    await user.type(screen.getByLabelText(/Tin nhắn cho trợ lý/), 'hỏi rồi bỏ đi')
    await user.click(screen.getByRole('button', { name: 'Gửi' }))

    view.unmount() // chuyển sang tab Lịch sử trong lúc chờ
    release()

    render_(p) // quay lại tab Trợ lý
    expect(await screen.findByText('trả lời muộn')).toBeInTheDocument()
  })

  it('báo BƯỚC đang chạy chứ không chỉ "đang suy nghĩ" (TC-51-11)', async () => {
    const user = userEvent.setup()
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const body = new ReadableStream<Uint8Array>({
          async start(c) {
            const enc = new TextEncoder()
            c.enqueue(
              enc.encode(
                `event: step\ndata: ${JSON.stringify({ label: 'Đang xem lại hồ sơ để trả lời' })}\n\n`,
              ),
            )
            await gate
            c.enqueue(enc.encode(`event: result\ndata: ${JSON.stringify({ kind: 'reply', text: 'xong' })}\n\n`))
            c.close()
          },
        })
        return { ok: true, body } as unknown as Response
      }),
    )
    render_(profile({ work: [{ org: 'X', role: 'D', highlights: ['a'] }] }))

    await user.type(screen.getByLabelText(/Tin nhắn cho trợ lý/), 'hỏi gì đó')
    await user.click(screen.getByRole('button', { name: 'Gửi' }))

    // Im lặng 30 giây khiến người dùng tưởng treo và bấm lại
    expect(await screen.findByText(/Đang xem lại hồ sơ để trả lời/)).toBeInTheDocument()
    release()
    expect(await screen.findByText('xong')).toBeInTheDocument()
  })
})
