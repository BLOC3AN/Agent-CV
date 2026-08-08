import type { Pool } from 'pg'

/**
 * Repository cho job bất đồng bộ — TDD §8.1, §12.1, UC-72.
 *
 * Vì sao có bảng `jobs` khi BullMQ đã tự quản lý hàng đợi:
 *
 *   · BullMQ dọn job cũ (removeOnComplete) — bảng này là lịch sử BỀN VỮNG,
 *     user vẫn xem lại được kết quả sau nhiều ngày.
 *   · Redis mất dữ liệu (restart, maxmemory eviction) không được làm mất
 *     trạng thái job của user. Postgres là nguồn sự thật, Redis là phương tiện.
 *   · Idempotency (BR-72.1) cần một UNIQUE constraint thật, không phải jobId
 *     của BullMQ vốn chỉ tồn tại trong vòng đời của queue.
 *
 * Quy ước: BullMQ điều phối *khi nào* chạy; bảng này ghi *đã xảy ra gì*.
 */

export type JobKind =
  | 'parse_cv'
  | 'export_pdf'
  | 'embed_profile'
  | 'match_analysis'

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

export interface JobRow {
  id: string
  userId: string | null
  kind: JobKind
  idempotencyKey: string
  status: JobStatus
  payload: Record<string, unknown>
  result: Record<string, unknown> | null
  error: string | null
  attempts: number
  createdAt: Date
  startedAt: Date | null
  finishedAt: Date | null
}

/**
 * Lỗi có mã máy đọc được. FE dựa vào `code` để hiện đúng hành động tiếp theo
 * thay vì màn hình lỗi trắng (BR-71.1) — ví dụ `NO_TEXT_LAYER` phải dẫn tới
 * lời mời nhập tay, không phải nút "Thử lại" vô nghĩa.
 */
export class JobError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'JobError'
  }
}

interface RawRow {
  id: string
  user_id: string | null
  kind: string
  idempotency_key: string
  status: string
  payload: Record<string, unknown>
  result: Record<string, unknown> | null
  error: string | null
  attempts: number
  created_at: Date
  started_at: Date | null
  finished_at: Date | null
}

const COLS = `id, user_id, kind, idempotency_key, status, payload, result,
              error, attempts, created_at, started_at, finished_at`

function toJob(r: RawRow): JobRow {
  return {
    id: r.id,
    userId: r.user_id,
    kind: r.kind as JobKind,
    idempotencyKey: r.idempotency_key,
    status: r.status as JobStatus,
    payload: r.payload ?? {},
    result: r.result,
    error: r.error,
    attempts: r.attempts,
    createdAt: r.created_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  }
}

export class JobRepo {
  constructor(private readonly pool: Pool) {}

  /**
   * BR-72.1: cùng input → cùng job, không xử lý lại.
   *
   * Dùng `ON CONFLICT DO UPDATE` thay vì `DO NOTHING` vì `DO NOTHING` không
   * trả về dòng nào khi trùng, buộc phải SELECT thêm một lượt — hở một khe
   * đua giữa hai worker. Update một trường không đổi là cách rẻ nhất để luôn
   * có RETURNING.
   *
   * NHƯNG idempotency chỉ đúng với việc ĐÃ HOẶC ĐANG chạy. Job `failed` /
   * `cancelled` mà vẫn dùng lại thì user tải lại đúng file đó sẽ nhận mãi lỗi
   * cũ, không cách nào thử lại — trong khi nguyên nhân (pdfkit chết, model quá
   * tải) có thể đã hết. Nên trạng thái cuối THẤT BẠI được hồi sinh về `queued`.
   *
   * `created` = "cần đẩy vào hàng đợi", gồm cả job mới lẫn job hồi sinh.
   * `revived` để API phân biệt hai trường hợp đó khi trả mã HTTP.
   */
  async enqueue(input: {
    userId: string | null
    kind: JobKind
    idempotencyKey: string
    payload?: Record<string, unknown>
  }): Promise<{ job: JobRow; created: boolean; revived: boolean }> {
    // CTE `prev` chạy trên ảnh chụp TRƯỚC khi UPSERT ghi, nên nó cho biết
    // trạng thái cũ. Không thể suy ra từ trạng thái mới: job vốn đang `queued`
    // và job vừa hồi sinh đều ra `queued`, mà cái đầu KHÔNG được đẩy lại vào
    // hàng đợi (sẽ chạy hai lần, tốn thời gian model đang khan hiếm).
    const { rows } = await this.pool.query<
      RawRow & { inserted: boolean; prev_status: string | null }
    >(
      `WITH prev AS (
         SELECT status FROM jobs WHERE idempotency_key = $3
       ), upsert AS (
         INSERT INTO jobs (user_id, kind, idempotency_key, payload)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (idempotency_key) DO UPDATE
           SET status  = CASE WHEN jobs.status IN ('failed','cancelled')
                              THEN 'queued' ELSE jobs.status END,
               payload = CASE WHEN jobs.status IN ('failed','cancelled')
                              THEN EXCLUDED.payload ELSE jobs.payload END,
               error       = CASE WHEN jobs.status IN ('failed','cancelled')
                                  THEN NULL ELSE jobs.error END,
               started_at  = CASE WHEN jobs.status IN ('failed','cancelled')
                                  THEN NULL ELSE jobs.started_at END,
               finished_at = CASE WHEN jobs.status IN ('failed','cancelled')
                                  THEN NULL ELSE jobs.finished_at END
         RETURNING ${COLS}, (xmax = 0) AS inserted
       )
       SELECT upsert.*, prev.status AS prev_status
         FROM upsert LEFT JOIN prev ON true`,
      [input.userId, input.kind, input.idempotencyKey, input.payload ?? {}],
    )
    const row = rows[0]!
    const revived =
      !row.inserted && (row.prev_status === 'failed' || row.prev_status === 'cancelled')
    return { job: toJob(row), created: row.inserted || revived, revived }
  }

  async get(id: string): Promise<JobRow | null> {
    const { rows } = await this.pool.query<RawRow>(
      `SELECT ${COLS} FROM jobs WHERE id = $1`,
      [id],
    )
    return rows.length ? toJob(rows[0]!) : null
  }

  async byIdempotencyKey(key: string): Promise<JobRow | null> {
    const { rows } = await this.pool.query<RawRow>(
      `SELECT ${COLS} FROM jobs WHERE idempotency_key = $1`,
      [key],
    )
    return rows.length ? toJob(rows[0]!) : null
  }

  /**
   * Đưa một job đã xong về hàng đợi khi kết quả tham chiếu tới dữ liệu đã mất.
   * Chỉ dùng cho các job có cơ chế tự kiểm tra tính toàn vẹn ở tầng gọi.
   */
  async requeueDone(id: string, payload: Record<string, unknown> = {}): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE jobs
          SET status = 'queued', payload = $2, result = NULL, error = NULL,
              attempts = 0, started_at = NULL, finished_at = NULL
        WHERE id = $1 AND status = 'done'`,
      [id, payload],
    )
    return (rowCount ?? 0) > 0
  }

  async listByUser(userId: string, limit = 20): Promise<JobRow[]> {
    const { rows } = await this.pool.query<RawRow>(
      `SELECT ${COLS} FROM jobs WHERE user_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [userId, limit],
    )
    return rows.map(toJob)
  }

  /**
   * Đánh dấu bắt đầu chạy. Trả `false` nếu job đã ở trạng thái cuối hoặc đã bị
   * huỷ — worker phải bỏ qua, không chạy tiếp.
   *
   * Điều kiện `status IN ('queued','running')` cho phép BullMQ retry một job
   * đang `running` (worker trước chết giữa chừng) nhưng chặn hẳn job đã
   * `cancelled`: user bấm huỷ trong lúc job nằm trong hàng đợi thì công việc
   * đó không được âm thầm chạy.
   */
  async markRunning(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE jobs
          SET status = 'running',
              attempts = attempts + 1,
              started_at = COALESCE(started_at, now())
        WHERE id = $1 AND status IN ('queued','running')`,
      [id],
    )
    return (rowCount ?? 0) > 0
  }

  async markDone(id: string, result: Record<string, unknown>): Promise<void> {
    await this.pool.query(
      `UPDATE jobs SET status = 'done', result = $2, error = NULL,
                      finished_at = now()
        WHERE id = $1 AND status <> 'cancelled'`,
      [id, result],
    )
  }

  /**
   * `willRetry` phân biệt "lần thử này hỏng" với "job hỏng hẳn". Chỉ lần cuối
   * mới chuyển sang `failed`; các lần giữa vẫn giữ `running` để UI không nhấp
   * nháy giữa lỗi và đang chạy khi BullMQ retry.
   */
  async markFailed(
    id: string,
    err: unknown,
    willRetry = false,
  ): Promise<void> {
    const code = err instanceof JobError ? err.code : 'INTERNAL'
    const msg = err instanceof Error ? err.message : String(err)
    await this.pool.query(
      `UPDATE jobs
          SET status = CASE WHEN $3 THEN status ELSE 'failed' END,
              error = $2,
              finished_at = CASE WHEN $3 THEN finished_at ELSE now() END
        WHERE id = $1 AND status <> 'cancelled'`,
      [id, `${code}: ${msg}`, willRetry],
    )
  }

  /** UC-72: huỷ job đang chờ. Job đã chạy xong thì huỷ không còn ý nghĩa. */
  async cancel(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE jobs SET status = 'cancelled', finished_at = now()
        WHERE id = $1 AND status IN ('queued','running')`,
      [id],
    )
    return (rowCount ?? 0) > 0
  }

  /**
   * Job kẹt ở `running` quá lâu = worker chết giữa chừng. Không có bước này
   * thì job đó treo vĩnh viễn và user chờ mãi.
   */
  async reapStale(olderThanMs = 30 * 60_000): Promise<number> {
    const { rowCount } = await this.pool.query(
      `UPDATE jobs
          SET status = 'failed', error = 'STALE: worker không phản hồi',
              finished_at = now()
        WHERE status = 'running'
          AND started_at < now() - ($1 || ' milliseconds')::interval`,
      [olderThanMs],
    )
    return rowCount ?? 0
  }
}
