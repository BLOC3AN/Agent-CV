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
//
// LƯU Ý MÔI TRƯỜNG KHÁC: `SET session_replication_role = replica` cần quyền
// superuser (hoặc role tương đương) trên Postgres — role có quyền thấp hơn sẽ
// gặp lỗi permission denied ở đúng dòng này. Ở môi trường đó phải chạy bằng
// role đủ quyền, hoặc tìm cách khác để vô hiệu hoá trigger cho phiên này.
await client.query('SET session_replication_role = replica')

// Tiền tố đánh dấu field mà ProfileSchema hoàn toàn không biết tới (không
// phải field v1 hợp lệ nhưng-không-có-chỗ-ở-v2 như `/basics/dob` — đó là loại
// khác, do chính profileToCV() cất). Field ở đây bị Zod strip trong im lặng
// ngay tại `ProfileSchema.parse()`, TRƯỚC KHI profileToCV() kịp thấy — nên
// phải bắt ở đây, so raw với parsed, chứ không có cách nào bắt được bên trong
// converter.
//
// AN TOÀN KHÔNG ĐỤNG HÀNG: mọi pointer droppedFields khác trong hệ thống này
// (`/basics/dob`, `/work/N/type`, `/skills/N/level`, `/skills/N/group`,
// `/projects/N/tech`, `/skills/_order`, `/_meta/verified...`) đều bắt đầu
// bằng tên một field TOP-LEVEL thật của ProfileSchema (`basics`, `work`,
// `skills`, `projects`, `_meta`). ProfileSchema chỉ có đúng các field
// top-level: schemaVersion, language, basics, education, work, projects,
// skills, activities, certifications, languages, _meta — không field nào
// tên `_unrecognized`, nên tiền tố này không thể trùng với bất kỳ pointer
// nào ở trên, bất kể field lạ thật sự tên gì.
const UNKNOWN_KEY_PREFIX = '/_unrecognized'

/**
 * Dò các khoá có trong `raw` (JSON thô đọc thẳng từ cột `data`) nhưng biến
 * mất sau khi `ProfileSchema.parse()` chạy qua — tức là Zod strip trong im
 * lặng vì field đó không nằm trong schema (chế độ mặc định của `z.object()`).
 * Quét đệ quy ở MỌI cấp, không chỉ top-level: field lạ có thể nằm sâu trong
 * một phần tử mảng (vd. `work[2].oldField`).
 *
 * KHÔNG qua chiều ngược lại (khoá có ở `parsed` nhưng không có ở `raw`): đó
 * là default Zod tự điền cho field optional vắng mặt (`links: []`, …) — thêm
 * vào, không phải mất đi, không phải việc của hàm này.
 */
function collectUnknownKeys(
  raw: unknown,
  parsed: unknown,
  pointer: string,
  out: Record<string, string>,
): void {
  if (Array.isArray(raw)) {
    if (!Array.isArray(parsed)) return
    raw.forEach((item, i) => collectUnknownKeys(item, parsed[i], `${pointer}/${i}`, out))
    return
  }
  if (raw !== null && typeof raw === 'object') {
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return
    const parsedObj = parsed as Record<string, unknown>
    for (const key of Object.keys(raw as Record<string, unknown>)) {
      const rawVal = (raw as Record<string, unknown>)[key]
      const childPointer = `${pointer}/${key}`
      if (!Object.prototype.hasOwnProperty.call(parsedObj, key)) {
        // Không biết trước kiểu (string/number/boolean/null/object/array):
        // luôn JSON.stringify để tự mô tả kiểu của chính nó — khác với các
        // field đã biết chắc là string ở profileToCV (dob, headline, …) nên
        // lưu trực tiếp. JSON.parse ở chiều khôi phục trả đúng nguyên kiểu.
        out[`${UNKNOWN_KEY_PREFIX}${childPointer}`] = JSON.stringify(rawVal)
        continue
      }
      collectUnknownKeys(rawVal, parsedObj[key], childPointer, out)
    }
  }
}

/** Đặt giá trị vào object theo JSON Pointer, tạo object/mảng cha nếu thiếu. */
function setAtPointer(root: Record<string, unknown>, pointer: string, value: unknown): void {
  const parts = pointer.split('/').filter(Boolean)
  let node: Record<string, unknown> = root
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!
    const next = node[key]
    if (next === undefined || next === null || typeof next !== 'object') {
      // Đoán object hay mảng dựa trên segment kế tiếp (số → mảng) — chỉ cần
      // cho ca hiếm cha cũng đã bị strip; bình thường cha luôn có sẵn (field
      // lạ nằm bên trong một object/mảng ProfileSchema đã biết).
      node[key] = /^\d+$/.test(parts[i + 1]!) ? [] : {}
    }
    node = node[key] as Record<string, unknown>
  }
  node[parts[parts.length - 1]!] = value
}

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
      // UNKNOWN_KEY_PREFIX ở trên).
      if (Object.keys(unknownKeys).length) {
        Object.assign(cv._meta.droppedFields, unknownKeys)
      }

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
      const cv = CVSchema.parse(row.data_v2)
      const profile = cvToProfile(cv)

      // Nghịch đảo của nhánh archive ở trên: cvToProfile() tự kết ở
      // `ProfileSchema.parse(...)`, nên field lạ không thể lọt qua bằng cách
      // nhét vào input của nó — sẽ bị strip lại y hệt lần đầu. Phải gắn lại
      // ở NGOÀI, sau khi cvToProfile() đã trả về object, và KHÔNG được chạy
      // qua ProfileSchema.parse() thêm lần nào nữa sau bước này.
      const restored: Record<string, unknown> = profile
      for (const [key, value] of Object.entries(cv._meta.droppedFields)) {
        if (!key.startsWith(UNKNOWN_KEY_PREFIX)) continue
        setAtPointer(restored, key.slice(UNKNOWN_KEY_PREFIX.length), JSON.parse(value))
      }

      if (dryRun) { ok++; continue }
      await client.query('UPDATE profiles SET data = $2::jsonb WHERE id = $1', [
        row.id,
        JSON.stringify(restored),
      ])
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
