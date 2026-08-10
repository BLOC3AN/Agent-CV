import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ChatPanel } from '../src/components/ChatPanel'
import { initialCVs } from '../src/mockData'

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
