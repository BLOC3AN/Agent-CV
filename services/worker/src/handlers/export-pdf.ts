import type { Pool } from 'pg'
import { JobError } from '@hr/db'
import { exportPdf, type ExportVariant } from '@hr/pdf'
import type { JobContext } from '../runner.js'
import { contentKey, type Storage } from '../storage.js'

/**
 * Job `export_pdf` — UC-31, UC-32, TDD §8.4.
 *
 * Worker render trang `/print/:cvId` bằng Chromium rồi in ra PDF. Chạy ở worker
 * chứ không ở request web vì một lần xuất tốn vài trăm MB RAM và ~1-3s — đủ để
 * làm nghẽn tiến trình web khi có nhiều người dùng cùng lúc.
 */

export interface ExportPdfPayload {
  cvId: string
  variant: ExportVariant
}

export interface ExportPdfDeps {
  pool: Pool
  storage: Storage
  /** Gốc URL mà worker dùng để mở trang in. Trong compose là `http://web:3000`. */
  webBaseUrl?: string
  /** Cho phép test thay thế mà không cần Chromium thật. */
  render?: typeof exportPdf
}

export function makeExportPdfHandler(deps: ExportPdfDeps) {
  const baseUrl = (deps.webBaseUrl ?? process.env.WEB_BASE_URL ?? 'http://localhost:3000').replace(
    /\/$/,
    '',
  )
  const render = deps.render ?? exportPdf

  return async function exportPdfJob(ctx: JobContext): Promise<Record<string, unknown>> {
    const { cvId, variant } = ctx.job.payload as unknown as ExportPdfPayload
    if (!cvId || !variant) throw new JobError('BAD_PAYLOAD', 'Thiếu cvId hoặc variant')
    if (variant !== 'presentation' && variant !== 'ats') {
      throw new JobError('BAD_PAYLOAD', `variant không hợp lệ: ${variant}`)
    }

    await ctx.progress(10, 'Đang mở bản in')

    let result: Awaited<ReturnType<typeof exportPdf>>
    try {
      result = await render({ url: `${baseUrl}/print/${cvId}?variant=${variant}`, variant })
    } catch (err) {
      // Chromium chết / trang không tải được. Đáng retry: thường là do web
      // service đang khởi động lại hoặc hết RAM tạm thời.
      throw new JobError(
        'RENDER_FAILED',
        `Không xuất được PDF: ${err instanceof Error ? err.message : String(err)}`,
        true,
      )
    }

    await ctx.progress(80, 'Đang lưu file')
    const key = contentKey(new Uint8Array(result.pdf), 'pdf')
    await deps.storage.put(key, new Uint8Array(result.pdf))

    // Một CV + một variant chỉ giữ một artifact mới nhất; bản cũ không còn
    // giá trị và giữ lại chỉ làm phình bảng.
    await deps.pool.query(
      `INSERT INTO export_artifacts (cv_id, variant, file_key, bytes)
       VALUES ($1, $2, $3, $4)`,
      [cvId, variant, key, result.bytes],
    )

    await ctx.progress(100, 'Xong')
    return { fileKey: key, bytes: result.bytes, ms: result.ms, variant }
  }
}
