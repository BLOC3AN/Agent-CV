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
import { collectUnknownKeys, reattachUnknownKeys } from './unknown-keys.js'
import { parseBackfillArgs } from './backfill-args.js'
import { assertReversible } from './roundtrip-compare.js'

// Đọc cờ TRƯỚC KHI mở kết nối: cờ sai phải chết ngay, đừng để tới lúc đã cầm
// con trỏ ghi trong tay. Cờ lạ là lỗi (không im lặng bỏ qua) và rollback ghi
// thật đòi CONFIRM_ROLLBACK=1 — xem backfill-args.ts.
let dryRun: boolean
let rollback: boolean
try {
  ;({ dryRun, rollback } = parseBackfillArgs(process.argv.slice(2), process.env))
} catch (err) {
  console.error(`✗ ${(err as Error).message}`)
  process.exit(1)
}

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
//
// LƯU Ý MÔI TRƯỜNG KHÁC: `SET session_replication_role = replica` cần quyền
// superuser (hoặc role tương đương) trên Postgres — role có quyền thấp hơn sẽ
// gặp lỗi permission denied ở đúng dòng này. Ở môi trường đó phải chạy bằng
// role đủ quyền, hoặc tìm cách khác để vô hiệu hoá trigger cho phiên này.
await client.query('SET session_replication_role = replica')

// `collectUnknownKeys`, `setAtPointer` (dùng trong `reattachUnknownKeys`) và
// tiền tố `/_unrecognized` sống ở backend/db/unknown-keys.ts — dùng CHUNG với
// roundtrip-check.ts, xem comment ở đó về lý do và về an toàn không đụng hàng
// của tiền tố.

let ok = 0
const failures: { id: string; reason: string }[] = []

if (!rollback) {
  const { rows } = await client.query<{ id: string; data: unknown; updated_at: Date }>(
    'SELECT id, data, updated_at FROM profiles ORDER BY id',
  )
  for (const row of rows) {
    try {
      const profile = ProfileSchema.parse(row.data)

      // Chuẩn hoá qua JSON để field `undefined` (Zod optional vắng mặt) biến
      // mất đúng như khi ghi xuống jsonb thật — nếu không, so sánh raw vs
      // parsed ở collectUnknownKeys() sẽ hiểu nhầm field undefined là field
      // "còn tồn tại nhưng khác raw", trong khi nó phải được coi là vắng mặt.
      const parsedForDiff = JSON.parse(JSON.stringify(profile)) as unknown
      const unknownKeys: Record<string, string> = {}
      collectUnknownKeys(row.data, parsedForDiff, '', unknownKeys)

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

      // Field ProfileSchema không biết tới không đi qua được profileToCV()
      // (profile ở trên đã bị Zod strip trước khi tới đó) — gắn thẳng vào
      // droppedFields của CV vừa tạo, cùng namespace với mọi thứ droppedFields
      // khác nhưng khác tiền tố nên không đụng hàng (xem comment
      // UNKNOWN_KEY_PREFIX trong backend/db/unknown-keys.ts).
      if (Object.keys(unknownKeys).length) {
        Object.assign(cv._meta.droppedFields, unknownKeys)
      }

      // Chứng minh đường lùi TRƯỚC KHI ghi, cho từng hàng, bằng ĐÚNG phép so
      // mà roundtrip-check.ts dùng. Trước đây tính chất "không có hàng data_v2
      // nào không lùi lại được" chỉ đúng nếu người vận hành nhớ chạy
      // roundtrip-check sau đó — một quy trình, tức là một thứ sẽ bị quên. Ném
      // lỗi ở đây biến nó thành tính chất của cấu trúc: hàng không chứng minh
      // được rơi vào `failures` kèm id và KHÔNG được ghi.
      //
      // Đi qua JSON.parse(JSON.stringify(cv)) để so trên đúng hình dạng sẽ nằm
      // trong jsonb (field `undefined` biến mất), không phải object trong bộ nhớ.
      const cvAsStored = JSON.parse(JSON.stringify(cv)) as unknown
      assertReversible(row.data, cvAsStored)

      if (dryRun) { ok++; continue }
      await client.query('UPDATE profiles SET data_v2 = $2::jsonb WHERE id = $1', [
        row.id,
        JSON.stringify(cv),
      ])
      // SP-5 publication reads the immutable document snapshot, not the
      // mutable profile row. Keep every CV document belonging to this
      // profile publishable in the same backfill pass.
      await client.query(
        'UPDATE cv_documents SET snapshot_v2 = $2::jsonb WHERE profile_id = $1',
        [row.id, JSON.stringify(cv)],
      )
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
      const cv = CVSchema.parse(row.data_v2)
      const profile = cvToProfile(cv)

      // Nghịch đảo của nhánh archive ở trên: cvToProfile() tự kết ở
      // `ProfileSchema.parse(...)`, nên field lạ không thể lọt qua bằng cách
      // nhét vào input của nó — sẽ bị strip lại y hệt lần đầu. Phải gắn lại
      // ở NGOÀI, sau khi cvToProfile() đã trả về object, và KHÔNG được chạy
      // qua ProfileSchema.parse() thêm lần nào nữa sau bước này.
      const restored = reattachUnknownKeys(profile, cv._meta.droppedFields)

      if (dryRun) { ok++; continue }
      await client.query('UPDATE profiles SET data = $2::jsonb WHERE id = $1', [
        row.id,
        JSON.stringify(restored),
      ])
      await client.query('UPDATE cv_documents SET snapshot_v2 = NULL WHERE profile_id = $1', [row.id])
      ok++
    } catch (err) {
      failures.push({ id: row.id, reason: (err as Error).message })
    }
  }
}

console.log(`${rollback ? 'Rollback' : 'Backfill'}${dryRun ? ' (dry-run)' : ''}: ` +
  `${ok} thành công, ${failures.length} lỗi.`)
for (const f of failures) console.error(`  ✗ ${f.id}: ${f.reason}`)

await client.end()
// Có một hàng hỏng cũng là thất bại: im lặng bỏ qua nghĩa là hàng đó ở lại v1
// mãi mãi, và không ai biết cho tới lúc SP-5 lật công tắc.
process.exit(failures.length ? 1 : 0)
