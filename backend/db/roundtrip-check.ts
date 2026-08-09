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
import { CVSchema, cvToProfile } from '@hr/schema'
import { reattachUnknownKeys } from './unknown-keys.js'

function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon)
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = canon((v as Record<string, unknown>)[k])
    }
    return out
  }
  return v
}

function firstDiff(a: string, b: string): string {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      return (
        `  tại vị trí ${i}\n` +
        `  raw     : …${a.slice(Math.max(0, i - 60), i + 60)}…\n` +
        `  restored: …${b.slice(Math.max(0, i - 60), i + 60)}…`
      )
    }
  }
  return '  (độ dài khác nhau nhưng không tìm được vị trí lệch đầu tiên)'
}

const url =
  process.env.DATABASE_URL ?? 'postgres://postgres:hragent_dev@localhost:5433/hragent'
const client = new Client({ connectionString: url })
await client.connect()

const { rows } = await client.query<{ id: string; data: unknown; data_v2: unknown }>(
  'SELECT id, data, data_v2 FROM profiles WHERE data_v2 IS NOT NULL ORDER BY id',
)

let same = 0
let diff = 0

for (const row of rows) {
  try {
    const cv = CVSchema.parse(row.data_v2)
    const profile = cvToProfile(cv)
    const restored = reattachUnknownKeys(profile, cv._meta.droppedFields)

    const a = JSON.stringify(canon(row.data))
    const b = JSON.stringify(canon(restored))
    if (a === b) {
      same++
    } else {
      diff++
      console.error(`✗ ${row.id} — data khôi phục từ data_v2 KHÔNG khớp raw`)
      console.error(firstDiff(a, b))
    }
  } catch (err) {
    // Lỗi khi dựng lại (vd. CVSchema/cvToProfile ném) cũng là một dạng
    // "không chứng minh được đường lùi nguyên vẹn" — tính là lệch, không bỏ
    // qua trong im lặng và không làm chết cả script giữa chừng các hàng khác.
    diff++
    console.error(`✗ ${row.id} — lỗi khi dựng lại: ${(err as Error).message}`)
  }
}

console.log(`raw ↔ reattach(cvToProfile(data_v2)): ${same} khớp, ${diff} lệch, ${rows.length} tổng cộng.`)
await client.end()
process.exit(diff ? 1 : 0)
