import { describe, expect, it, vi, afterEach } from 'vitest'
import { ApiError } from '../src/lib/api'
import { downloadCVPDF } from '../src/lib/download-pdf'

afterEach(() => vi.restoreAllMocks())

function pdfResponse(headers: Record<string, string> = {}) {
  return new Response(new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], { type: 'application/pdf' }), {
    status: 200,
    headers: { 'content-type': 'application/pdf', ...headers },
  })
}

/** Thu lại thẻ <a> mà hàm tải dựng ra, kèm URL blob nó cấp phát và thu hồi. */
function captureDownload() {
  const clicked: HTMLAnchorElement[] = []
  const revoked: string[] = []
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:cv-pdf')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => { revoked.push(url) })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push(this)
  })
  return { clicked, revoked }
}

describe('downloadCVPDF', () => {
  it('giao file cho trình duyệt qua thẻ tải, không điều hướng trang', async () => {
    const { clicked } = captureDownload()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(pdfResponse()))

    await downloadCVPDF('cv-1')

    expect(clicked).toHaveLength(1)
    expect(clicked[0]!.href).toBe('blob:cv-pdf')
    expect(clicked[0]!.hasAttribute('download')).toBe(true)
  })

  it('gọi đúng endpoint PDF kèm cookie phiên', async () => {
    captureDownload()
    const fetchMock = vi.fn().mockResolvedValue(pdfResponse())
    vi.stubGlobal('fetch', fetchMock)

    await downloadCVPDF('cv 1/á')

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`/print/${encodeURIComponent('cv 1/á')}/pdf`)
    expect(init.credentials).toBe('include')
  })

  /*
   * Tên file là thứ người dùng thấy trong thư mục Downloads. Máy chủ gửi kèm
   * `filename*` dạng RFC 5987 để dấu tiếng Việt không bị bóp méo.
   */
  it('lấy tên file từ Content-Disposition của máy chủ', async () => {
    const { clicked } = captureDownload()
    const disposition = `attachment; filename="CV.pdf"; filename*=UTF-8''${encodeURIComponent('CV Nguyễn Văn A.pdf')}`
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(pdfResponse({ 'content-disposition': disposition })))

    await downloadCVPDF('cv-1')

    expect(clicked[0]!.getAttribute('download')).toBe('CV Nguyễn Văn A.pdf')
  })

  it('lùi về tên mặc định khi máy chủ không gửi tên', async () => {
    const { clicked } = captureDownload()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(pdfResponse()))

    await downloadCVPDF('cv-1')

    expect(clicked[0]!.getAttribute('download')).toMatch(/\.pdf$/)
  })

  it('thu hồi URL blob sau khi tải, không rò bộ nhớ', async () => {
    const { revoked } = captureDownload()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(pdfResponse()))

    await downloadCVPDF('cv-1')

    expect(revoked).toEqual(['blob:cv-pdf'])
  })

  it('ném ApiError mang thông điệp của máy chủ khi dựng PDF hỏng', async () => {
    captureDownload()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Không dựng được PDF', { status: 500, headers: { 'content-type': 'text/plain' } })))

    await expect(downloadCVPDF('cv-1')).rejects.toThrowError(ApiError)
  })

  it('không giao file khi máy chủ trả lỗi', async () => {
    const { clicked } = captureDownload()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('không thấy CV', { status: 404 })))

    await expect(downloadCVPDF('cv-1')).rejects.toThrow()
    expect(clicked).toHaveLength(0)
  })
})
