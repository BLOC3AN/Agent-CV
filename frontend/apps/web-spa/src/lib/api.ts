/**
 * Nơi DUY NHẤT trong SPA biết đường dẫn HTTP.
 *
 * Màn hình gọi hàm ở đây, không tự dựng URL. Nhờ vậy khi backend đổi đường
 * dẫn, chỗ phải sửa là một file — và khi có ai quên `credentials: 'include'`,
 * lỗi đó không thể lặp lại ở mười chỗ khác nhau.
 */

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export interface CVSummary {
  id: string
  title: string
  /** ISO-8601 UTC, do backend sinh. Định dạng để hiển thị là việc của giao diện. */
  updatedAt: string
  /** Vắng mặt nghĩa là CV không gắn tin tuyển dụng nào. */
  jdTitle?: string
}

export interface Session {
  authenticated: boolean
  email?: string
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      // Cookie hr_session là HttpOnly — không có dòng này thì trình duyệt
      // không gửi nó, và mọi thứ trả về 401.
      credentials: 'include',
      ...init,
    })
  } catch {
    throw new ApiError(0, 'Không kết nối được máy chủ')
  }

  const text = await res.text()
  let body: unknown = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      // Cổng lỗi trả HTML, không phải JSON. Đừng để chi tiết đó thành lỗi cú pháp.
      body = null
    }
  }

  if (!res.ok) {
    const message =
      body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : 'Máy chủ trả về lỗi'
    throw new ApiError(res.status, message)
  }

  return body as T
}

export async function listCVs(): Promise<CVSummary[]> {
  const body = await request<{ items: CVSummary[] }>('/api/cv')
  return body.items ?? []
}

export async function deleteCV(id: string): Promise<void> {
  await request<unknown>(`/api/cv/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/**
 * Không bao giờ ném. Câu hỏi "tôi là ai" được đặt ở mỗi lần tải trang; để nó
 * ném thì backend chết sẽ thành màn hình trắng thay vì màn hình đăng nhập.
 */
export async function getSession(): Promise<Session> {
  try {
    return await request<Session>('/api/auth/session')
  } catch {
    return { authenticated: false }
  }
}

export async function requestLogin(email: string): Promise<{ ok: boolean; devLink?: string }> {
  return request<{ ok: boolean; devLink?: string }>('/api/auth/request', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: email.trim().toLowerCase() }),
  })
}

export async function logout(): Promise<void> {
  await request<unknown>('/api/auth/logout', { method: 'POST' })
}
