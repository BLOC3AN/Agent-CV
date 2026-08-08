'use client'

import { createContext, useContext, type ReactNode } from 'react'

/**
 * Field — cầu nối giữa template và editor (FRONTEND.md §9.4).
 *
 * Template CHỈ khai báo `path` (JSON Pointer). Toàn bộ logic sửa inline nằm ở
 * `apps/web`, không rải rác trong từng template. Nhờ vậy:
 *   · Print/PDF render ra thẻ tĩnh, không dính code editor
 *   · Thêm template mới không phải viết lại logic sửa
 *   · Đổi cách sửa (inline → modal) chỉ sửa một chỗ
 *
 * ── Vì sao "use client" ────────────────────────────────────────────────────
 * React Context không dùng được trong Server Component của Next App Router.
 * Đánh dấu client ở đây khiến cả cây template thành client component — nhưng
 * Next VẪN server-render chúng ở lần đầu, nên trang /print vẫn ra HTML đầy đủ,
 * đúng thứ Playwright cần để in PDF.
 *
 * Đánh đổi: trang /print tải thêm runtime React (~40KB). Không đáng kể vì đó là
 * route nội bộ chỉ Playwright gọi. Cách thay thế — tách hai entry point
 * server/client — làm `sections.tsx` phải import hai `Field` khác nhau, phức
 * tạp hơn nhiều so với lợi ích.
 */

export interface FieldProps {
  /** JSON Pointer tới field trong Profile, ví dụ "/work/0/highlights/1" */
  path: string
  children: ReactNode
  /** Cho phép xuống dòng khi sửa */
  multiline?: boolean
  /** Text gợi ý khi rỗng — chỉ hiện ở chế độ sửa */
  placeholder?: string
  className?: string
  as?: 'span' | 'div' | 'li' | 'p' | 'h1' | 'h2' | 'h3'
}

export type FieldRenderer = (props: FieldProps) => ReactNode

/** Mặc định: render tĩnh. Dùng cho print, PDF, thumbnail. */
const staticRenderer: FieldRenderer = ({ children, className, as = 'span' }) => {
  const Tag = as
  return <Tag className={className}>{children}</Tag>
}

const FieldContext = createContext<FieldRenderer>(staticRenderer)

export function FieldProvider({
  renderer,
  children,
}: {
  renderer: FieldRenderer
  children: ReactNode
}) {
  return <FieldContext.Provider value={renderer}>{children}</FieldContext.Provider>
}

export function Field(props: FieldProps) {
  const render = useContext(FieldContext)
  return <>{render(props)}</>
}

