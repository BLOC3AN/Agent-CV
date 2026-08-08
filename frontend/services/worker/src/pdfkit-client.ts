import { JobError } from '@hr/db'

/**
 * Client cho `services/pdfkit` — TDD §8.1, §12.1.
 *
 * Service này chỉ trích text, không gọi LLM, nên nhanh; timeout ngắn là đúng.
 * Nhưng PDF 20 trang render ảnh thì lâu hơn nhiều — tách timeout riêng.
 */

export type TextQuality = 'good' | 'suspect' | 'none'

export interface ExtractResult {
  text: string
  engine: 'pymupdf' | 'poppler' | 'none'
  quality: TextQuality
  reasons: string[]
  pages: number
  columns: number
  hasType3: boolean
  garbleCount: number
  engineDiff: number
  fonts: string[]
  blocks?: { page: number; bbox: [number, number, number, number]; text: string }[]
}

export interface SegmentResult extends ExtractResult {
  sections: { kind: string; heading: string; body: string; start: number }[]
  /** Các mục cùng loại đã gộp — khoá là `kind`. */
  merged: Record<string, string>
}

export interface PdfkitClientOptions {
  baseUrl?: string
  timeoutMs?: number
  renderTimeoutMs?: number
  fetchImpl?: typeof fetch
}

export class PdfkitClient {
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly renderTimeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(opts: PdfkitClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? process.env.PDFKIT_URL ?? 'http://localhost:8100').replace(
      /\/$/,
      '',
    )
    this.timeoutMs = opts.timeoutMs ?? 60_000
    this.renderTimeoutMs = opts.renderTimeoutMs ?? 120_000
    this.fetchImpl = opts.fetchImpl ?? fetch
  }

  async health(): Promise<boolean> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(3_000),
      })
      return res.ok
    } catch {
      return false
    }
  }

  async extract(pdf: Uint8Array, filename = 'cv.pdf', includeBlocks = false): Promise<ExtractResult> {
    const qs = includeBlocks ? '?includeBlocks=true' : ''
    return this.post<ExtractResult>(`/extract${qs}`, pdf, filename, this.timeoutMs)
  }

  async segment(pdf: Uint8Array, filename = 'cv.pdf'): Promise<SegmentResult> {
    return this.post<SegmentResult>('/segment', pdf, filename, this.timeoutMs)
  }

  async render(
    pdf: Uint8Array,
    opts: { dpi?: number; maxPages?: number } = {},
    filename = 'cv.pdf',
  ): Promise<{ dpi: number; pages: { index: number; png: string }[] }> {
    const qs = new URLSearchParams({
      dpi: String(opts.dpi ?? 200),
      maxPages: String(opts.maxPages ?? 10),
    })
    return this.post(`/render?${qs}`, pdf, filename, this.renderTimeoutMs)
  }

  private async post<T>(
    path: string,
    pdf: Uint8Array,
    filename: string,
    timeoutMs: number,
  ): Promise<T> {
    const form = new FormData()
    // Copy sang ArrayBuffer riêng: Uint8Array có thể là view của một buffer
    // lớn hơn (Node hay trả vậy), Blob sẽ nuốt cả phần thừa.
    const bytes = pdf.slice()
    form.append('file', new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }), filename)

    let res: Response
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {
      // pdfkit chết/khởi động lại là lỗi hạ tầng — đáng retry
      throw new JobError(
        'PDFKIT_UNAVAILABLE',
        `Không gọi được pdfkit: ${err instanceof Error ? err.message : String(err)}`,
        true,
      )
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      // 4xx = dữ liệu người dùng sai → retry vô nghĩa. 5xx = phía service.
      throw new JobError(
        res.status === 415 || res.status === 413 ? 'BAD_FILE' : 'PDFKIT_ERROR',
        `pdfkit trả ${res.status}: ${body.slice(0, 300)}`,
        res.status >= 500,
      )
    }

    return (await res.json()) as T
  }
}
