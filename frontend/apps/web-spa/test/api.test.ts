import { describe, expect, it, vi, afterEach } from 'vitest'
import { ApiError, deleteCV, getSession, listCVs, requestLogin } from '../src/lib/api.js'

function mockFetch(status: number, body: unknown, contentType = 'application/json') {
  const spy = vi.fn(async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': contentType },
    }),
  )
  vi.stubGlobal('fetch', spy)
  return spy
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('listCVs', () => {
  it('trả về mảng items và gửi kèm cookie', async () => {
    const spy = mockFetch(200, {
      items: [{ id: 'cv-1', title: 'CV Backend', updatedAt: '2026-08-09T10:30:00Z' }],
    })

    const items = await listCVs()

    expect(items).toEqual([
      { id: 'cv-1', title: 'CV Backend', updatedAt: '2026-08-09T10:30:00Z' },
    ])
    expect((spy.mock.calls as any)[0]?.[0]).toBe('/api/cv')
    // Thiếu `credentials: 'include'` thì cookie phiên không được gửi và mọi
    // request đều 401 — hỏng theo kiểu trông như "chưa đăng nhập".
    expect((spy.mock.calls as any)[0]?.[1]).toMatchObject({ credentials: 'include' })
  })

  it('danh sách rỗng là mảng rỗng, không phải lỗi', async () => {
    mockFetch(200, { items: [] })
    await expect(listCVs()).resolves.toEqual([])
  })

  it('401 ném ApiError giữ nguyên mã trạng thái', async () => {
    mockFetch(401, { error: 'Chưa đăng nhập' })

    const err = await listCVs().catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ApiError)
    if (err instanceof ApiError) {
      expect(err.status).toBe(401)
      expect(err.message).toBe('Chưa đăng nhập')
    }
  })

  it('body không phải JSON vẫn ném ApiError chứ không vỡ', async () => {
    mockFetch(502, '<html>Bad Gateway</html>', 'text/html')

    const err = await listCVs().catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ApiError)
    if (err instanceof ApiError) {
      expect(err.status).toBe(502)
    }
  })
})

describe('deleteCV', () => {
  it('gọi DELETE đúng đường dẫn và mã hoá id', async () => {
    const spy = mockFetch(200, { ok: true })

    await deleteCV('cv/1')

    expect((spy.mock.calls as any)[0]?.[0]).toBe('/api/cv/cv%2F1')
    expect((spy.mock.calls as any)[0]?.[1]).toMatchObject({ method: 'DELETE' })
  })
})

describe('getSession', () => {
  it('đọc trạng thái đăng nhập', async () => {
    mockFetch(200, { authenticated: true, email: 'a@b.com' })
    await expect(getSession()).resolves.toEqual({ authenticated: true, email: 'a@b.com' })
  })

  it('mạng hỏng thì coi như chưa đăng nhập, không ném', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network') }))
    await expect(getSession()).resolves.toEqual({ authenticated: false })
  })
})

describe('requestLogin', () => {
  it('gửi email và trả devLink khi backend cung cấp', async () => {
    const spy = mockFetch(200, { ok: true, sent: false, devLink: 'http://x/verify?token=t' })

    const result = await requestLogin('  A@B.COM ')

    expect(JSON.parse((spy.mock.calls as any)[0]?.[1]?.body as string)).toEqual({ email: 'a@b.com' })
    expect(result.devLink).toBe('http://x/verify?token=t')
  })
})
