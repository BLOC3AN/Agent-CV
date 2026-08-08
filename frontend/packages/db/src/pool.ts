import pg from 'pg'

/** Pool dùng chung. Tách ra để test inject được pool riêng. */
let shared: pg.Pool | null = null

export function getPool(url?: string): pg.Pool {
  if (!shared) {
    shared = new pg.Pool({
      connectionString:
        url ?? process.env.DATABASE_URL ?? 'postgres://postgres:hragent_dev@localhost:5433/hragent',
      max: 10,
      idleTimeoutMillis: 30_000,
    })
  }
  return shared
}

export async function closePool(): Promise<void> {
  if (shared) { await shared.end(); shared = null }
}

export type { Pool } from 'pg'

/**
 * Chuẩn bị một giá trị JS cho cột `jsonb`.
 *
 * Driver `pg` tự chuyển OBJECT thành JSON, nhưng biến MẢNG thành mảng Postgres
 * (`{1,2}`) — cột jsonb từ chối cú pháp đó với lỗi
 * "invalid input syntax for type json".
 *
 * Đã mắc lỗi này HAI LẦN ở hai chỗ khác nhau, và lần thứ hai để lại hậu quả
 * thật: patch đã áp dụng vào hồ sơ nhưng đề xuất vẫn ở trạng thái `pending`,
 * nên người dùng áp dụng được lần thứ hai và nội dung bị sửa chồng.
 *
 * Dùng hàm này cho MỌI tham số đi vào cột jsonb — kể cả object, để không phải
 * dừng lại nghĩ xem giá trị đó có phải mảng hay không.
 */
export function jsonb(value: unknown): string {
  return JSON.stringify(value ?? null)
}
