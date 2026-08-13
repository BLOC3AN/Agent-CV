import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ChatPanel } from '../src/components/ChatPanel'
import { initialCVs } from './fixtures/cvs'

const { sendChat, settleChatProposal } = vi.hoisted(() => ({
  sendChat: vi.fn(),
  settleChatProposal: vi.fn(),
}))

vi.mock('../src/lib/api', () => ({ sendChat, saveCV: vi.fn(), settleChatProposal }))

afterEach(() => vi.clearAllMocks())

function patchResult(proposalId: string, summary: string) {
  return {
    kind: 'patch',
    proposalId,
    summary,
    ops: [{ op: 'replace', path: '/sections/skills/0/skills/0', value: 'Python (Advanced)', rationale: 'Rõ hơn', grounding: { type: 'existing_field', ref: 'cv-1' } }],
    rejected: [],
  }
}

function typeAndSend(text: string) {
  const input = screen.getByLabelText('Tin nhắn cho trợ lý')
  fireEvent.change(input, { target: { value: text } })
  fireEvent.submit(input.closest('form')!)
}

/*
 * Bảng đề xuất từng được render SAU cả danh sách tin nhắn, nên nó luôn bị ghim
 * ở đáy khung dù người dùng đã gửi thêm bao nhiêu câu. Cộng với việc khung chat
 * không tự cuộn, cái bảng cao ấy chiếm hết tầm nhìn và câu mới nhất bị đẩy khuất
 * lên trên. Gốc rễ là sai thứ tự thời gian, không phải z-index.
 */
describe('bảng đề xuất neo theo dòng hội thoại', () => {
  it('đặt tin nhắn mới xuống dưới bảng đề xuất đang mở', async () => {
    sendChat.mockResolvedValueOnce(patchResult('proposal-1', 'Đề xuất kỹ năng') as never)
    render(<ChatPanel profileId="profile-1" cvId="cv-1" cv={initialCVs[0]!} onApplyAIProposal={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Viết lại kỹ năng' }))
    const panel = await screen.findByTestId('ai-proposal')

    sendChat.mockResolvedValueOnce({ kind: 'reply', text: 'Trả lời cho câu sau' } as never)
    typeAndSend('câu mới của tôi')

    const newer = await screen.findByText('câu mới của tôi')
    expect(panel.compareDocumentPosition(newer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('chỉ giữ một bảng sống khi có đề xuất mới, tóm tắt cũ ở lại trong lịch sử', async () => {
    sendChat.mockResolvedValueOnce(patchResult('proposal-1', 'Đề xuất cũ') as never)
    render(<ChatPanel profileId="profile-1" cvId="cv-1" cv={initialCVs[0]!} onApplyAIProposal={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Viết lại kỹ năng' }))
    await screen.findByTestId('ai-proposal')

    sendChat.mockResolvedValueOnce(patchResult('proposal-2', 'Đề xuất mới') as never)
    typeAndSend('làm lại giúp tôi')

    await screen.findByText('Đề xuất mới')
    expect(screen.getAllByTestId('ai-proposal')).toHaveLength(1)
    // Bảng cũ biến mất nhưng câu tóm tắt của nó vẫn là một phần lịch sử chat.
    expect(screen.getByText('Đề xuất cũ')).toBeInTheDocument()
  })

  it('không nhân đôi câu tóm tắt giữa bong bóng chat và bảng đề xuất', async () => {
    sendChat.mockResolvedValueOnce(patchResult('proposal-1', 'Đề xuất kỹ năng') as never)
    render(<ChatPanel profileId="profile-1" cvId="cv-1" cv={initialCVs[0]!} onApplyAIProposal={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Viết lại kỹ năng' }))
    await screen.findByTestId('ai-proposal')

    expect(screen.getAllByText('Đề xuất kỹ năng')).toHaveLength(1)
  })
})

describe('tự cuộn khung chat', () => {
  function stubScrollMetrics(element: HTMLElement, scrollHeight: number, clientHeight: number) {
    Object.defineProperty(element, 'scrollHeight', { value: scrollHeight, configurable: true })
    Object.defineProperty(element, 'clientHeight', { value: clientHeight, configurable: true })
  }

  it('cuộn xuống đáy khi người dùng gửi câu hỏi', async () => {
    sendChat.mockResolvedValue({ kind: 'reply', text: 'ok' } as never)
    render(<ChatPanel profileId="profile-1" cvId="cv-1" cv={initialCVs[0]!} onApplyAIProposal={vi.fn()} />)

    const scroller = screen.getByTestId('chat-scroll')
    stubScrollMetrics(scroller, 900, 300)
    scroller.scrollTop = 0

    typeAndSend('câu hỏi mới')

    await waitFor(() => expect(scroller.scrollTop).toBe(900))
  })

  /*
   * Đang cuộn lên đọc lại đề xuất cũ mà bị kéo tuột xuống mỗi lần AI trả lời
   * thì auto-scroll thành phiền. Chỉ bám đáy khi người dùng vốn đã ở đáy.
   */
  it('không giật người dùng về đáy khi họ cuộn lên đọc lịch sử trong lúc chờ AI', async () => {
    let deliverReply!: (value: unknown) => void
    sendChat.mockImplementationOnce(() => new Promise((resolve) => { deliverReply = resolve }))
    render(<ChatPanel profileId="profile-1" cvId="cv-1" cv={initialCVs[0]!} onApplyAIProposal={vi.fn()} />)

    const scroller = screen.getByTestId('chat-scroll')
    stubScrollMetrics(scroller, 900, 300)

    // Gửi câu hỏi thì được cuộn xuống đáy — đó là hành vi đúng của nhánh kia.
    fireEvent.click(screen.getByRole('button', { name: 'Viết lại kỹ năng' }))
    expect(scroller.scrollTop).toBe(900)

    // Rồi người dùng cuộn ngược lên đọc lại, TRONG LÚC AI còn đang nghĩ.
    scroller.scrollTop = 100
    fireEvent.scroll(scroller)

    deliverReply({ kind: 'reply', text: 'câu trả lời đến sau' })
    await screen.findByText('câu trả lời đến sau')

    expect(scroller.scrollTop).toBe(100)
  })
})
