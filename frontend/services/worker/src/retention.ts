import type { Pool } from 'pg'
import type { Storage } from './storage.js'

/**
 * Dọn file gốc sau thời hạn lưu trữ — TDD §15.2 R3, TC-SEC-05.
 *
 * > "File PDF gốc xóa sau 48 giờ. Chỉ giữ Profile đã chuẩn hóa."
 *
 * Đây là cam kết với người dùng, không phải việc dọn rác cho đỡ đầy ổ. Không
 * chạy nó thì mọi CV từng tải lên nằm nguyên trên đĩa vô thời hạn, và câu
 * "chúng tôi xoá sau 48 giờ" trong Chính sách bảo mật thành lời nói dối.
 */

export const RETENTION_MS = 48 * 60 * 60 * 1000

export interface PurgeResult {
  scanned: number
  deleted: number
  /** File còn job khác chưa hết hạn dùng chung → giữ lại, chỉ đánh dấu job này */
  shared: number
  errors: number
}

interface Row {
  id: string
  storage_key: string | null
}

/**
 * Xoá file của mọi job quá hạn.
 *
 * Khoá lưu trữ là sha256 NỘI DUNG, nên hai người tải cùng một file sẽ trỏ vào
 * cùng một khoá. Xoá theo job sẽ làm hỏng job của người kia — vì vậy chỉ xoá
 * khi KHÔNG còn job nào chưa dọn dùng chung khoá đó.
 */
export async function purgeExpiredFiles(
  pool: Pool,
  storage: Storage,
  opts: { retentionMs?: number; limit?: number; now?: Date } = {},
): Promise<PurgeResult> {
  const retention = opts.retentionMs ?? RETENTION_MS
  const limit = opts.limit ?? 500
  const result: PurgeResult = { scanned: 0, deleted: 0, shared: 0, errors: 0 }

  const { rows } = await pool.query<Row>(
    `SELECT id, payload->>'storageKey' AS storage_key
       FROM jobs
      WHERE file_purged_at IS NULL
        AND payload ? 'storageKey'
        AND created_at < ${opts.now ? '$2::timestamptz' : 'now()'} - ($1 || ' milliseconds')::interval
      ORDER BY created_at
      LIMIT ${limit}`,
    opts.now ? [retention, opts.now] : [retention],
  )

  for (const row of rows) {
    result.scanned++
    if (!row.storage_key) {
      await mark(pool, row.id)
      continue
    }

    // Còn job nào CHƯA dọn dùng chung khoá này không (ngoài chính nó)?
    const { rows: others } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM jobs
        WHERE payload->>'storageKey' = $1
          AND id <> $2
          AND file_purged_at IS NULL`,
      [row.storage_key, row.id],
    )

    if (Number(others[0]?.n ?? 0) > 0) {
      // Job khác vẫn còn hạn dùng file này. Đánh dấu job hiện tại đã dọn; job
      // cuối cùng hết hạn sẽ là job xoá file thật.
      result.shared++
      await mark(pool, row.id)
      continue
    }

    try {
      await storage.remove(row.storage_key)
      await mark(pool, row.id)
      result.deleted++
    } catch {
      // Không đánh dấu khi xoá lỗi: lượt sau phải thử lại, nếu không file ở lại
      // vĩnh viễn mà bảng thì báo đã dọn.
      result.errors++
    }
  }

  return result
}

async function mark(pool: Pool, jobId: string): Promise<void> {
  await pool.query('UPDATE jobs SET file_purged_at = now() WHERE id = $1', [jobId])
}
