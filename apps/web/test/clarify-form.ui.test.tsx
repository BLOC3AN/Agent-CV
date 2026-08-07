import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClarifyForm } from '@/components/chat/ClarifyForm'

describe('ClarifyForm', () => {
  it('giữ giá trị riêng cho từng ô dù model trả id câu hỏi bị trùng', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()

    render(
      <ClarifyForm
        data={{
          originalMessage: 'thêm hoạt động',
          request: {
            reason: 'Cần thêm thông tin',
            targetPath: '/activities',
            questions: [
              { id: 'q', question: 'Hoạt động nào?' },
              { id: 'q', question: 'Có số liệu không?' },
              { id: 'q', question: 'Vai trò của bạn là gì?' },
            ],
          },
        }}
        onSubmit={onSubmit}
        onSkip={vi.fn()}
      />,
    )

    const first = screen.getByLabelText('Hoạt động nào?')
    const second = screen.getByLabelText('Có số liệu không?')
    const third = screen.getByLabelText('Vai trò của bạn là gì?')

    await user.type(first, 'CLB AI')

    expect(first).toHaveValue('CLB AI')
    expect(second).toHaveValue('')
    expect(third).toHaveValue('')

    await user.type(second, 'Không có số liệu')
    await user.click(screen.getByRole('button', { name: 'Gửi' }))

    expect(onSubmit).toHaveBeenCalledWith([
      { question: 'Hoạt động nào?', answer: 'CLB AI' },
      { question: 'Có số liệu không?', answer: 'Không có số liệu' },
    ])
  })
})
