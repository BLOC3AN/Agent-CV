'use client'

import { useId, type ReactNode } from 'react'

/**
 * Nhãn + input + gợi ý + lỗi, nối dây a11y sẵn.
 *
 * ── Vì sao dùng render-prop thay vì bọc từng loại input ──
 * Form trong app dùng `input`, `textarea` và `select`. Bọc riêng mỗi loại là
 * ba component gần giống nhau, và cái thứ tư (ví dụ combobox) lại phải viết
 * thêm. Render-prop trả về đúng những thuộc tính cần nối, còn chọn thẻ gì là
 * việc của chỗ gọi.
 *
 * `aria-describedby` gộp CẢ gợi ý lẫn lỗi: người dùng trình đọc màn hình cần
 * nghe cả hai, không phải chọn một.
 */
export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string
  hint?: string
  error?: string
  required?: boolean
  children: (attrs: {
    id: string
    required?: boolean
    'aria-describedby'?: string
    'aria-invalid'?: true
  }) => ReactNode
}) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`

  const describedBy = [hint ? hintId : null, error ? errorId : null]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1 block text-[13px] font-medium text-ink">
        {label}
        {required && (
          <span aria-hidden="true" className="ml-1 text-danger">
            *
          </span>
        )}
      </label>

      {children({
        id,
        ...(required ? { required: true } : {}),
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        ...(error ? { 'aria-invalid': true as const } : {}),
      })}

      {hint && (
        <p id={hintId} className="mt-1 text-[12px] text-ink-subtle">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-[12px] text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
