import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ChatPanel } from '../src/components/ChatPanel'
import { initialCVs } from '../src/mockData'

const { sendChat } = vi.hoisted(() => ({
  sendChat: vi.fn().mockResolvedValue({ kind: 'reply', text: 'Đã phân tích CV.' }),
}))

vi.mock('../src/lib/api', () => ({
  sendChat,
  saveCV: vi.fn(),
  settleChatProposal: vi.fn(),
}))

describe('ChatPanel — giao diện trợ lý AI', () => {
  it('hiển thị đúng bố cục mẫu, ba model và sáu gợi ý', () => {
    render(<ChatPanel profileId="profile-1" cvId="cv-1" cv={initialCVs[0]!} onApplied={vi.fn()} />)

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
    render(<ChatPanel profileId="profile-1" cvId="cv-1" cv={initialCVs[0]!} onApplied={vi.fn()} />)

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
    ))
    expect(await screen.findByText('AI GỢI Ý')).toBeInTheDocument()
    expect(screen.getByText('Đã phân tích CV.')).toBeInTheDocument()
  })
})
