/**
 * Tải CV về máy dưới dạng file PDF.
 *
 * Không dùng `window.location.assign`: điều hướng tới một endpoint trả lỗi sẽ
 * quăng người dùng ra khỏi trình sửa để nhìn một trang lỗi trần. Đọc phản hồi
 * bằng `fetch` rồi tự giao blob cho trình duyệt thì lỗi ở lại trong giao diện,
 * và trang đang mở không hề nhúc nhích.
 *
 * Cũng không dùng `window.print()`: nó chỉ mở hộp thoại in để người dùng tự
 * lưu, và bị nuốt lặng lẽ trong tài liệu bị sandbox.
 */

import { ApiError } from './api'

const DEFAULT_FILENAME = 'CV.pdf'

/**
 * Tên file do máy chủ đặt. `filename*` (RFC 5987) ưu tiên hơn `filename` vì
 * chỉ nó chở được dấu tiếng Việt; `filename` thuần ASCII là bản dự phòng cho
 * trình duyệt cũ.
 */
export function filenameFromDisposition(header: string | null): string {
  if (!header) return DEFAULT_FILENAME
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)
  if (encoded?.[1]) {
    try {
      return decodeURIComponent(encoded[1].trim())
    } catch {
      // Header méo thì rơi xuống dạng ASCII bên dưới.
    }
  }
  const plain = /filename="([^"]*)"/i.exec(header) ?? /filename=([^;]+)/i.exec(header)
  return plain?.[1]?.trim() || DEFAULT_FILENAME
}

export async function downloadCVPDF(cvId: string): Promise<void> {
  const response = await fetch(`/print/${encodeURIComponent(cvId)}/pdf`, { credentials: 'include' })
  if (!response.ok) {
    const message = await response.text().catch(() => '')
    throw new ApiError(response.status, message || 'Không tải được PDF')
  }

  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filenameFromDisposition(response.headers.get('content-disposition'))
    anchor.click()
  } finally {
    URL.revokeObjectURL(url)
  }
}
