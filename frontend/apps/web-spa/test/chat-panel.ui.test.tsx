import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ChatPanel } from '../src/components/ChatPanel'
import { initialCVs } from './fixtures/cvs'
import { LocaleProvider, BuilderLocaleProvider } from '../src/lib/i18n'

const { sendChat, settleChatProposal } = vi.hoisted(() => ({
  sendChat: vi.fn().mockResolvedValue({ kind: 'reply', text: 'Đã phân tích CV.' }),
  settleChatProposal: vi.fn(),
}))

vi.mock('../src/lib/api', () => ({
  sendChat,
  saveCV: vi.fn(),
  settleChatProposal,
}))

afterEach(() => vi.clearAllMocks())

describe('ChatPanel — giao diện trợ lý AI', () => {
  it('hiển thị đúng bố cục mẫu, ba model và sáu gợi ý', () => {
    render(<ChatPanel profileId="profile-1" cvId="cv-1" cv={initialCVs[0]!} onApplyAIProposal={vi.fn()} />)

    expect(screen.getByRole('region', { name: 'Trợ lý AI HR-Agent' })).toBeInTheDocument()
    expect(screen.getByLabelText('MÔ HÌNH AI')).toHaveValue('local.reasoner')
    expect(screen.getByRole('option', { name: 'Neura Flash' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Neura Plus' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Neura Pro' })).toBeInTheDocument()

    for (const label of [
      'Tối ưu kinh nghiệm',
      'Rút gọn giới thiệu',
      'Sửa lỗi chính tả',
      'Viết lại kỹ năng',
      'Tạo tóm tắt',
      'Gợi ý cải thiện',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }

    expect(screen.getByPlaceholderText('Yêu cầu AI chỉnh sửa CV...')).toBeInTheDocument()
  })

  it('gửi quick action bằng model đang chọn và hiển thị phản hồi AI', async () => {
    sendChat.mockResolvedValue({ kind: 'reply', text: 'Đã phân tích CV.' })
    render(<ChatPanel profileId="profile-1" cvId="cv-1" cv={initialCVs[0]!} onApplyAIProposal={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('MÔ HÌNH AI'), { target: { value: 'openai.luna' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tạo tóm tắt' }))

    await waitFor(() => expect(sendChat).toHaveBeenCalledWith(
      'profile-1',
      'Tạo tóm tắt',
      [],
      'openai.luna',
      undefined,
      expect.any(AbortSignal),
      expect.any(Function),
      expect.objectContaining({ cvId: 'cv-1', draftVersion: 0 }),
      'vi',
    ))
    expect(await screen.findByText('AI GỢI Ý')).toBeInTheDocument()
    expect(screen.getByText('Đã phân tích CV.')).toBeInTheDocument()
  })

  it('forwards selected operations to the local draft and says they still need Save', async () => {
    sendChat.mockResolvedValue({
      kind: 'patch', proposalId: 'proposal-1', summary: 'Đề xuất AI',
      ops: [{ op: 'replace', path: '/sections/intro/fullName', value: 'AI draft', rationale: 'Rõ hơn', grounding: { type: 'profile', ref: 'cv-1' } }],
      rejected: [],
    })
    settleChatProposal.mockResolvedValue({ applied: 1, status: 'accepted', selectedOps: [{ op: 'replace', path: '/sections/intro/fullName', value: 'AI draft', rationale: 'Rõ hơn', grounding: { type: 'profile', ref: 'cv-1' } }] })
    const onApplyAIProposal = vi.fn()
    render(<ChatPanel profileId="profile-1" cvId="cv-1" cv={initialCVs[0]!} onApplyAIProposal={onApplyAIProposal} />)

    fireEvent.click(screen.getByRole('button', { name: 'Tạo tóm tắt' }))
    await screen.findAllByText('Đề xuất AI')
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng vào CV' }))

    await waitFor(() => expect(onApplyAIProposal).toHaveBeenCalledWith(expect.any(Array), 'Đề xuất AI'))
    expect(screen.getByText(/đã đưa 1 thay đổi vào bản nháp.*lưu/i)).toBeInTheDocument()
  })

  it('shows an assistant error instead of claiming malformed operations were applied', async () => {
    sendChat.mockResolvedValue({
      kind: 'patch', proposalId: 'proposal-1', summary: 'Đề xuất AI',
      ops: [{ op: 'move', path: '/sections/intro/fullName', value: 'AI draft', rationale: 'Rõ hơn', grounding: { type: 'profile', ref: 'cv-1' } }],
      rejected: [],
    } as never)
    settleChatProposal.mockResolvedValue({ applied: 1, status: 'accepted', selectedOps: [{ op: 'move', path: '/sections/intro/fullName', value: 'AI draft', rationale: 'Rõ hơn', grounding: { type: 'profile', ref: 'cv-1' } }] } as never)
    render(<ChatPanel profileId="profile-1" cvId="cv-1" cv={initialCVs[0]!} onApplyAIProposal={() => { throw new Error('Op JSON Patch không được hỗ trợ') }} />)

    fireEvent.click(screen.getByRole('button', { name: 'Tạo tóm tắt' }))
    await screen.findAllByText('Đề xuất AI')
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng vào CV' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/op json patch không được hỗ trợ/i)
    expect(screen.queryByText(/đã đưa 1 thay đổi vào bản nháp/i)).not.toBeInTheDocument()
  })

  it('preflights against the current draft and keeps the proposal when the draft has diverged', async () => {
    sendChat.mockResolvedValue({
      kind: 'patch', proposalId: 'proposal-1', summary: 'Đề xuất trên bản cũ',
      ops: [{ op: 'replace', path: '/sections/intro/missing', value: 'stale', rationale: 'Stale', grounding: { type: 'profile', ref: 'cv-1' } }],
      rejected: [],
    } as never)
    const onApplyAIProposal = vi.fn()
    render(<ChatPanel profileId="profile-1" cvId="cv-1" cv={{ ...initialCVs[0]!, schemaVersion: 2, language: 'vi', _meta: { verified: {}, source: 'manual', canonical: {} } } as never} layout={{ version: 1, nodes: [{ id: 'header', type: 'header', visible: true }] }} draftVersion={4} onApplyAIProposal={onApplyAIProposal} />)

    fireEvent.click(screen.getByRole('button', { name: 'Tạo tóm tắt' }))
    await screen.findAllByText('Đề xuất trên bản cũ')
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng vào CV' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/không được phép/i)
    expect(settleChatProposal).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Áp dụng vào CV' })).toBeInTheDocument()
  })
})


describe('ngôn ngữ trả lời của AI', () => {
  /*
   * Mô hình chỉ biết trả lời tiếng gì nếu client nói cho nó. Trước đây prompt
   * bảo "trả lời cùng ngôn ngữ với hồ sơ", nên CV tiếng Việt luôn nhận câu trả
   * lời tiếng Việt kể cả khi giao diện đang tiếng Anh.
   */
  it('gửi ngôn ngữ giao diện lên cho máy chủ', async () => {
    localStorage.setItem('hr-locale', 'en')
    sendChat.mockResolvedValue({ kind: 'reply', text: 'ok' })
    render(
      <LocaleProvider>
        <BuilderLocaleProvider>
          <ChatPanel profileId="profile-1" cvId="cv-1" cv={initialCVs[0]!} onApplyAIProposal={vi.fn()} />
        </BuilderLocaleProvider>
      </LocaleProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /write a summary/i }))

    await waitFor(() => expect(sendChat).toHaveBeenCalled())
    expect(sendChat.mock.calls.at(-1)!.at(-1)).toBe('en')
    localStorage.clear()
  })

  /**
   * Máy chủ tự suy ra `grounding.type`; `inference` nghĩa là nội dung đó không có
   * trong CV lẫn lời người dùng. Đo thật trên Qwen3.5-4B cho 21/27 op rơi vào
   * loại này, với những con số model tự nghĩ ra như "giảm 30% số cuộc gọi".
   *
   * Bỏ tick sẵn thôi thì chưa đủ: người dùng chỉ thấy một đề xuất "bị lỗi" và
   * tick lại. Phải nói ra lý do thì việc bỏ tick mới có tác dụng.
   */
  it('cảnh báo và bỏ tick sẵn đề xuất mà CV không có căn cứ', async () => {
    sendChat.mockResolvedValue({
      kind: 'patch', proposalId: 'proposal-1', summary: 'Đề xuất viết lại',
      ops: [
        { op: 'replace', path: '/sections/intro/fullName', value: 'Có căn cứ', rationale: 'r', grounding: { type: 'existing_field', ref: 'cv-1' } },
        { op: 'replace', path: '/sections/intro/title', value: 'Giảm 30% thời gian xử lý', rationale: 'r', grounding: { type: 'inference', ref: 'cv-1' } },
      ],
      rejected: [],
    } as never)
    render(<ChatPanel profileId="profile-1" cvId="cv-1" cv={initialCVs[0]!} onApplyAIProposal={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Tạo tóm tắt' }))
    await screen.findAllByText('Đề xuất viết lại')

    expect(screen.getAllByTestId('unverified-change')).toHaveLength(1)
    expect(screen.getByText(/chưa có trong cv/i)).toBeInTheDocument()

    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes[0]!.checked).toBe(true)
    expect(boxes[1]!.checked).toBe(false)
  })

  /**
   * Gặp thật: trợ lý hỏi "muốn tôi đề xuất chỉnh sửa cho từng phần không?",
   * người dùng đáp "có", model sinh 43 op và máy chủ ném sạch cả 43 kèm câu
   * tiếng Anh "invalid number of changes". Giờ máy chủ cắt về trần 20 và gửi kèm
   * số đã đề xuất; bảng duyệt phải nói ra con số đó.
   */
  it('nói rõ còn bao nhiêu thay đổi chưa hiện khi đề xuất bị cắt', async () => {
    sendChat.mockResolvedValue({
      kind: 'patch', proposalId: 'proposal-1', summary: 'Đề xuất cập nhật',
      ops: [{ op: 'replace', path: '/sections/intro/fullName', value: 'A', rationale: 'r', grounding: { type: 'existing_field', ref: 'cv' } }],
      proposedOps: 43,
      rejected: [],
    } as never)
    render(<ChatPanel profileId="profile-1" cvId="cv-1" cv={initialCVs[0]!} onApplyAIProposal={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Tạo tóm tắt' }))
    await screen.findAllByText('Đề xuất cập nhật')

    const notice = await screen.findByTestId('proposal-trimmed')
    expect(notice).toHaveTextContent('43')
    expect(notice).toHaveTextContent('1')
  })

  /**
   * Gặp thật trên production: model xoá /certifications/0 rồi vẫn trỏ tới
   * /certifications/5 theo chỉ số của mảng BAN ĐẦU. Máy chủ nay bỏ đúng op hỏng
   * và giữ phần còn lại — bảng duyệt phải nói ra cái nào rơi, nếu không người
   * dùng tưởng yêu cầu đã được làm trọn.
   */
  it('hiện những thay đổi bị bỏ vì không áp được', async () => {
    sendChat.mockResolvedValue({
      kind: 'patch', proposalId: 'proposal-1', summary: 'Đề xuất cập nhật',
      ops: [{ op: 'replace', path: '/sections/intro/fullName', value: 'A', rationale: 'r', grounding: { type: 'existing_field', ref: 'cv' } }],
      proposedOps: 1,
      rejected: [{ path: '/sections/certifications/5/name', reason: 'mục này không còn ở vị trí đó sau các thay đổi phía trên' }],
    } as never)
    render(<ChatPanel profileId="profile-1" cvId="cv-1" cv={initialCVs[0]!} onApplyAIProposal={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Tạo tóm tắt' }))
    await screen.findAllByText('Đề xuất cập nhật')

    const box = await screen.findByTestId('proposal-rejected')
    expect(box).toHaveTextContent('/sections/certifications/5/name')
    expect(box).toHaveTextContent(/không còn ở vị trí đó/)
    // Op dùng được vẫn phải hiện và tick sẵn — bỏ một op không được chặn cả bảng.
    expect((screen.getAllByRole('checkbox')[0] as HTMLInputElement).checked).toBe(true)
  })

  it('không nói gì khi đề xuất nằm trong trần', async () => {
    sendChat.mockResolvedValue({
      kind: 'patch', proposalId: 'proposal-1', summary: 'Đề xuất cập nhật',
      ops: [{ op: 'replace', path: '/sections/intro/fullName', value: 'A', rationale: 'r', grounding: { type: 'existing_field', ref: 'cv' } }],
      proposedOps: 1,
      rejected: [],
    } as never)
    render(<ChatPanel profileId="profile-1" cvId="cv-1" cv={initialCVs[0]!} onApplyAIProposal={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Tạo tóm tắt' }))
    await screen.findAllByText('Đề xuất cập nhật')

    expect(screen.queryByTestId('proposal-trimmed')).not.toBeInTheDocument()
  })
})
