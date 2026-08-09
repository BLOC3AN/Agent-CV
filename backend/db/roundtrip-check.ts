#!/usr/bin/env tsx
/**
 * Chứng minh chỉ-đọc cho đúng một điều: chiều lùi (v2 → v1) không làm mất gì
 * so với `data` gốc.
 *
 * Đây là property gác cổng cho toàn bộ migration này — sự vắng mặt của nó là
 * nguyên nhân của sự cố mất dữ liệu thật (chạy `--rollback` trên DB sống để
 * "thử" mới lộ ra `/skills` và `basics.summary` bị mất). Script này thay thế
 * hẳn kiểu "thử rollback thật rồi xem có mất gì không": nó chứng minh đúng
 * property đó mà không cần ghi bất cứ thứ gì.
 *
 * CHỈ ĐỌC — không có UPDATE/INSERT/DELETE nào trong file này. Chạy lại không
 * bao giờ là thứ có thể làm hỏng dữ liệu.
 *
 * Chạy: npx tsx ../backend/db/roundtrip-check.ts
 *       (hoặc npm run db:roundtrip-check trong frontend/)
 *
 * So với RAW `data`, KHÔNG so với `ProfileSchema.parse(data)`: so với bản đã
 * parse là chính xác lỗi đã che giấu mất `basics.summary` ở lần trước — bản
 * đã parse đã tự bị Zod strip field lạ trước khi so sánh, nên hai bên "khớp"
 * một cách giả tạo dù dữ liệu thật đã mất. Raw là nguồn sự thật duy nhất.
 */
import { Client } from 'pg'
// `canon`/`firstDiff`/phép so sống ở roundtrip-compare.ts và dùng CHUNG với
// backfill-v2.ts — backfill gọi đúng phép so này trước mỗi UPDATE, nên script
// này và cái chốt chặn ở đó không thể trôi khỏi nhau.
import { diffRestored } from './roundtrip-compare.js'

const url =
  process.env.DATABASE_URL ?? 'postgres://postgres:hragent_dev@localhost:5433/hragent'
const client = new Client({ connectionString: url })
await client.connect()

const { rows } = await client.query<{ id: string; data: unknown; data_v2: unknown }>(
  'SELECT id, data, data_v2 FROM profiles WHERE data_v2 IS NOT NULL ORDER BY id',
)

// Đếm TOÀN BỘ hồ sơ, không chỉ hàng đã có data_v2. Chỉ báo cáo trên hàng đã
// backfill thì sau một lượt backfill dở dang, script in "20 khớp, 0 lệch" và
// thoát 0 — một lời chứng nhận xanh cho một cơ sở dữ liệu chưa được chuyển
// xong. Hàng chưa có data_v2 là hàng CHƯA CHỨNG MINH được gì, phải hiện ra.
const { rows: totalRows } = await client.query<{ count: string }>(
  'SELECT count(*)::text AS count FROM profiles',
)
const total = Number(totalRows[0]!.count)
const missing = total - rows.length

let same = 0
let diff = 0

for (const row of rows) {
  // Lỗi khi dựng lại (vd. CVSchema/cvToProfile ném) cũng là một dạng "không
  // chứng minh được đường lùi nguyên vẹn" — diffRestored() gói nó lại thành
  // một mô tả lệch, không bỏ qua trong im lặng và không làm chết cả script
  // giữa chừng các hàng khác.
  const detail = diffRestored(row.data, row.data_v2)
  if (detail === null) {
    same++
  } else {
    diff++
    console.error(`✗ ${row.id} — ${detail}`)
  }
}

console.log(
  `raw ↔ reattach(cvToProfile(data_v2)): ${same} khớp, ${diff} lệch trên ${rows.length} hàng có ` +
    `data_v2 / ${total} hồ sơ tổng cộng.`,
)
if (missing > 0) {
  console.error(
    `✗ ${missing} hồ sơ CHƯA có data_v2 — chưa chứng minh được gì cho những hàng đó. ` +
      `Chạy npm run db:backfill-v2 rồi kiểm lại.`,
  )
}
await client.end()
process.exit(diff || missing ? 1 : 0)
