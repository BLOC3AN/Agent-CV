#!/usr/bin/env tsx
/**
 * Backfill v1 → v2 (và ngược lại).
 *
 * Chạy:
 *   npm run db:backfill-v2                # v1 → v2
 *   npm run db:backfill-v2 -- --dry-run   # chỉ đếm, không ghi
 *   npm run db:backfill-v2 -- --rollback  # v2 → v1, dựng lại `data` từ `data_v2`
 *
 * IDEMPOTENT: chạy n lần cho cùng kết quả như chạy một lần. Không có tính chất
 * này thì không ai dám chạy lại sau khi nó hỏng giữa chừng, mà hỏng giữa chừng
 * là chuyện sẽ xảy ra.
 */
import { Client } from 'pg'
import { ProfileSchema, CVSchema, profileToCV, cvToProfile } from '@hr/schema'

const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')
const rollback = args.has('--rollback')

const url =
  process.env.DATABASE_URL ?? 'postgres://postgres:hragent_dev@localhost:5433/hragent'
const client = new Client({ connectionString: url })
await client.connect()

// `profiles` có trigger `profiles_touch` (BEFORE UPDATE) tự set
// `updated_at = now()` trên MỌI update, kể cả update chỉ đụng `data_v2`.
// Backfill đọc `updated_at` để suy ra `lastModified` (idempotent — xem
// comment ở dưới), nên nếu để trigger chạy, chính UPDATE của lượt chạy thứ
// nhất sẽ đẩy `updated_at` sang giờ chạy script; lượt chạy thứ hai đọc lại
// `updated_at` đã bị đẩy đó, tính ra `lastModified` khác, và `data_v2` đổi —
// không còn idempotent nữa dù bản thân code không hề gọi `new Date()`.
// Tắt trigger cho đúng phiên kết nối này (session_replication_role chỉ ảnh
// hưởng tới connection hiện tại, không đổi gì ở schema) để UPDATE của script
// không làm trôi `updated_at` — cột đó vẫn phản ánh đúng nghĩa "người dùng
// sửa hồ sơ lần cuối", không phải "backfill chạy lần cuối".
await client.query('SET session_replication_role = replica')

let ok = 0
let skipped = 0
const failures: { id: string; reason: string }[] = []

if (!rollback) {
  const { rows } = await client.query<{ id: string; data: unknown; updated_at: Date }>(
    'SELECT id, data, updated_at FROM profiles ORDER BY id',
  )
  for (const row of rows) {
    try {
      const profile = ProfileSchema.parse(row.data)

      // Guard bổ sung (ngoài phạm vi cvToProfile, xem ghi chú hạn chế đã biết
      // trong cv-migrate.ts): `_meta.canonical` khoá theo TÊN kỹ năng, nên hai
      // skill v1 trùng tên nhưng canonical khác nhau không thể round-trip đúng
      // — ghi data_v2 cho ca này là ghi một bản không rollback lại được đúng.
      // Phát hiện ở đây, trước khi ghi, thay vì để cvToProfile() âm thầm mất
      // thông tin ở chiều ngược lại.
      const canonicalByName = new Map<string, string>()
      for (const s of profile.skills) {
        if (!s.canonical) continue
        const prev = canonicalByName.get(s.name)
        if (prev !== undefined && prev !== s.canonical) {
          throw new Error(
            `hai skill tên "${s.name}" có canonical khác nhau ("${prev}" và ` +
              `"${s.canonical}") — _meta.canonical khoá theo tên nên không round-trip được`,
          )
        }
        canonicalByName.set(s.name, s.canonical)
      }

      const cv = profileToCV(profile, {
        id: row.id,
        title: profile.basics.name ? `CV của ${profile.basics.name}` : 'CV của tôi',
        // Lấy từ cột updated_at chứ không phải giờ hiện tại: dùng giờ hiện tại
        // thì mỗi lần chạy lại ra một giá trị khác và script hết idempotent.
        lastModified: row.updated_at.toISOString(),
      })
      if (dryRun) { ok++; continue }
      await client.query('UPDATE profiles SET data_v2 = $2::jsonb WHERE id = $1', [
        row.id,
        JSON.stringify(cv),
      ])
      ok++
    } catch (err) {
      failures.push({ id: row.id, reason: (err as Error).message })
    }
  }
} else {
  const { rows } = await client.query<{ id: string; data_v2: unknown }>(
    'SELECT id, data_v2 FROM profiles WHERE data_v2 IS NOT NULL ORDER BY id',
  )
  for (const row of rows) {
    try {
      const profile = cvToProfile(CVSchema.parse(row.data_v2))
      if (dryRun) { ok++; continue }
      await client.query('UPDATE profiles SET data = $2::jsonb WHERE id = $1', [
        row.id,
        JSON.stringify(profile),
      ])
      ok++
    } catch (err) {
      failures.push({ id: row.id, reason: (err as Error).message })
    }
  }
}

console.log(`${rollback ? 'Rollback' : 'Backfill'}${dryRun ? ' (dry-run)' : ''}: ` +
  `${ok} thành công, ${skipped} bỏ qua, ${failures.length} lỗi.`)
for (const f of failures) console.error(`  ✗ ${f.id}: ${f.reason}`)

await client.end()
// Có một hàng hỏng cũng là thất bại: im lặng bỏ qua nghĩa là hàng đó ở lại v1
// mãi mãi, và không ai biết cho tới lúc SP-5 lật công tắc.
process.exit(failures.length ? 1 : 0)
