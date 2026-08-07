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

  it('bắt buộc thì báo cho cả người nhìn lẫn trình đọc màn hình', () => {
    render(<Field label="Email" required>{(a) => <input {...a} />}</Field>)
    expect(screen.getByLabelText(/Email/)).toBeRequired()
  })
})
