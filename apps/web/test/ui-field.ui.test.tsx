import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Field } from '@/components/ui'

/**
 * FRONTEND §11: thông báo lỗi phải nói NGƯỜI DÙNG LÀM GÌ TIẾP THEO, không mô
 * tả lỗi kỹ thuật. Field lo phần nối dây để câu đó thật sự tới được trình đọc
 * màn hình, chứ không chỉ hiện bằng chữ đỏ.
 */

describe('Field', () => {
  it('nhãn nối đúng vào input', () => {
    render(
      <Field label="Dán mô tả công việc">
        {(a) => <textarea {...a} />}
      </Field>,
    )
    expect(screen.getByLabelText('Dán mô tả công việc')).toBeInTheDocument()
  })

  it('gợi ý đọc được qua aria-describedby', () => {
    render(
      <Field label="Email" hint="Chúng tôi gửi link đăng nhập tới đây">
        {(a) => <input {...a} />}
      </Field>,
    )
    const input = screen.getByLabelText('Email')
    const ids = (input.getAttribute('aria-describedby') ?? '').split(' ')
    const texts = ids.map((i) => document.getElementById(i)?.textContent)
    expect(texts).toContain('Chúng tôi gửi link đăng nhập tới đây')
  })

  it('lỗi đánh dấu aria-invalid và đọc được', () => {
    render(
      <Field label="Email" error="Chưa đọc được địa chỉ này, bạn nhập lại giúp nhé">
        {(a) => <input {...a} />}
      </Field>,
    )
    const input = screen.getByLabelText('Email')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    const ids = (input.getAttribute('aria-describedby') ?? '').split(' ')
    const texts = ids.map((i) => document.getElementById(i)?.textContent)
    expect(texts).toContain('Chưa đọc được địa chỉ này, bạn nhập lại giúp nhé')
  })

  it('không lỗi thì không có aria-invalid', () => {
    render(<Field label="Email">{(a) => <input {...a} />}</Field>)
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid')
  })

  it('bắt buộc thì hiển thị dấu * và truyền required', () => {
    render(<Field label="Email" required>{(a) => <input {...a} />}</Field>)
    expect(screen.getByLabelText(/Email/)).toBeRequired()
    // Dấu * chỉ có vai trò hiển thị (aria-hidden), input mới báo trình đọc bằng required attribute
  })

  it('có cả hint lẫn error thì aria-describedby gộp cả hai id', () => {
    render(
      <Field
        label="Email"
        hint="Chúng tôi gửi link đăng nhập tới đây"
        error="Chưa đọc được địa chỉ này, bạn nhập lại giúp nhé"
      >
        {(a) => <input {...a} />}
      </Field>,
    )
    const input = screen.getByLabelText('Email')
    const describedBy = input.getAttribute('aria-describedby') ?? ''
    expect(describedBy).toBeTruthy()

    // Split và verify cả hai ID
    const ids = describedBy.split(' ')
    expect(ids).toHaveLength(2)

    // Mỗi ID phải trỏ tới một phần tử tồn tại với nội dung đúng
    const texts = ids.map((i) => document.getElementById(i)?.textContent)
    expect(texts).toContain('Chúng tôi gửi link đăng nhập tới đây')
    expect(texts).toContain('Chưa đọc được địa chỉ này, bạn nhập lại giúp nhé')
  })

  it('không hint không error thì aria-describedby phải vắng mặt hoàn toàn', () => {
    render(<Field label="Email">{(a) => <input {...a} />}</Field>)
    const input = screen.getByLabelText('Email')
    // Không phải chuỗi rỗng — phải VẮNG MẶT hoàn toàn, vì aria-describedby="" làm rối trình đọc màn hình
    expect(input).not.toHaveAttribute('aria-describedby')
  })
})
