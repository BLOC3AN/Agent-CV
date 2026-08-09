import { describe, expect, it } from 'vitest'

/**
 * Test tích hợp — cần `docker compose --profile full up -d web-spa backend`.
 * Nằm ở project `integration`, không chạy trong bộ test thường.
 */
const BASE = process.env.SPA_BASE_URL ?? 'http://localhost:3002'

describe('SPA đóng gói', () => {
  it('phục vụ trang chủ dạng HTML', async () => {
    const res = await fetch(BASE + '/')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
  })

  it('URL sâu trả về HTML chứ không phải 404 — SPA tự định tuyến phía trình duyệt', async () => {
    const res = await fetch(BASE + '/cv')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
  })

  it('/api/health đi tới backend Go, không phải một handler cục bộ', async () => {
    const res = await fetch(BASE + '/api/health')
    expect(res.status).toBe(200)
    // `service: backend-go` chỉ có ở Go. Nhận được nó nghĩa là proxy đã thông,
    // và Express không còn tự trả lời /api/health như trước.
    expect(await res.json()).toMatchObject({ ok: true, service: 'backend-go' })
  })

  it('chưa đăng nhập thì GET /api/cv trả 401 từ Go', async () => {
    const res = await fetch(BASE + '/api/cv')
    expect(res.status).toBe(401)
  })
})
