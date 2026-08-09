/**
 * Archive-and-restore cho field mà `ProfileSchema` không biết tới.
 *
 * `ProfileSchema.parse()` (Zod `.object()` mặc định "strip") xoá âm thầm mọi
 * key nó không khai báo. `cvToProfile()` tự kết bằng `ProfileSchema.parse(...)`
 * nên field lạ không thể sống sót qua nó bằng cách nhét vào input — sẽ bị
 * strip lại y hệt lần đầu (bug thật: hai hồ sơ có `basics.summary` — migration
 * 009 cố tình để lại — bị mất field này qua backfill vì lẽ đó).
 *
 * Cơ chế "nhớ field lạ ở chiều đi, gắn lại ở chiều về" phải nằm NGOÀI hai
 * converter đó (packages/schema đã đóng băng), và dùng CHUNG giữa
 * `backfill-v2.ts` (ghi `data_v2` thật / rollback `data` thật) và
 * `roundtrip-check.ts` (kiểm tra chỉ-đọc, không ghi gì) — một bản copy-paste
 * hai nơi sẽ trôi, và trôi trong im lặng, đúng thứ toàn bộ task này đang
 * chống. Vì vậy sống ở một file riêng, cả hai script import từ đây.
 */

/**
 * Tiền tố đánh dấu field ProfileSchema hoàn toàn không biết tới — khác với
 * field v1 hợp lệ nhưng-không-có-chỗ-ở-v2 (ví dụ `/basics/dob`, do chính
 * `profileToCV()` cất). Field ở đây bị Zod strip ngay tại
 * `ProfileSchema.parse()`, TRƯỚC KHI `profileToCV()` kịp thấy.
 *
 * AN TOÀN KHÔNG ĐỤNG HÀNG: mọi pointer droppedFields khác trong hệ thống
 * (`/basics/dob`, `/work/N/type`, `/skills/N/level`, `/skills/N/group`,
 * `/projects/N/tech`, `/skills/_order`, `/_meta/verified...`) đều bắt đầu
 * bằng tên một field TOP-LEVEL thật của `ProfileSchema` (`basics`, `work`,
 * `skills`, `projects`, `_meta`). `ProfileSchema` chỉ có đúng các field
 * top-level: `schemaVersion`, `language`, `basics`, `education`, `work`,
 * `projects`, `skills`, `activities`, `certifications`, `languages`,
 * `_meta` — không field nào tên `_unrecognized`, nên tiền tố này an toàn
 * tuyệt đối, không phụ thuộc việc đoán trước tên field lạ nào sẽ xuất hiện.
 */
export const UNKNOWN_KEY_PREFIX = '/_unrecognized'

/**
 * Dò các khoá có trong `raw` (JSON thô đọc thẳng từ cột `data`) nhưng biến
 * mất sau khi `ProfileSchema.parse()` chạy qua — tức là Zod strip trong im
 * lặng vì field đó không nằm trong schema. Quét đệ quy ở MỌI cấp, không chỉ
 * top-level: field lạ có thể nằm sâu trong một phần tử mảng (vd.
 * `work[2].oldField`).
 *
 * KHÔNG quét chiều ngược lại (khoá có ở `parsed` nhưng không có ở `raw`): đó
 * là default Zod tự điền cho field optional vắng mặt (`links: []`, …) — thêm
 * vào, không phải mất đi, không phải việc của hàm này.
 *
 * Không biết trước kiểu giá trị lạ (string/number/boolean/null/object/array)
 * nên luôn `JSON.stringify` khi cất — tự mô tả kiểu của chính nó — khác với
 * các field đã biết chắc là string ở `profileToCV` (dob, headline, …) vốn
 * lưu string trực tiếp.
 */
export function collectUnknownKeys(
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
        out[`${UNKNOWN_KEY_PREFIX}${childPointer}`] = JSON.stringify(rawVal)
        continue
      }
      collectUnknownKeys(rawVal, parsedObj[key], childPointer, out)
    }
  }
}

/**
 * Đặt giá trị vào object theo JSON Pointer, tạo object/mảng cha nếu thiếu.
 *
 * Nhánh "cha thiếu, phải đoán object hay mảng" không có input thật nào của
 * bộ công cụ này chạm tới (field lạ luôn nằm trong một object/mảng
 * ProfileSchema đã biết và đã dựng sẵn) — để lại như một nhánh phòng thủ đã
 * ghi nhận là không dùng tới, không xoá vì rẻ và vô hại.
 */
export function setAtPointer(root: Record<string, unknown>, pointer: string, value: unknown): void {
  const parts = pointer.split('/').filter(Boolean)
  let node: Record<string, unknown> = root
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!
    const next = node[key]
    if (next === undefined || next === null || typeof next !== 'object') {
      node[key] = /^\d+$/.test(parts[i + 1]!) ? [] : {}
    }
    node = node[key] as Record<string, unknown>
  }
  node[parts[parts.length - 1]!] = value
}

/**
 * Gắn lại mọi field đã cất ở `collectUnknownKeys()` vào object đã dựng bởi
 * `cvToProfile()`. Gọi SAU `cvToProfile()`, không bao giờ chạy `base` qua
 * `ProfileSchema.parse()` thêm lần nào nữa — parse lại sẽ strip đúng những
 * field vừa gắn.
 */
export function reattachUnknownKeys(
  base: Record<string, unknown>,
  droppedFields: Record<string, string>,
): Record<string, unknown> {
  for (const [key, value] of Object.entries(droppedFields)) {
    if (!key.startsWith(UNKNOWN_KEY_PREFIX)) continue
    setAtPointer(base, key.slice(UNKNOWN_KEY_PREFIX.length), JSON.parse(value))
  }
  return base
}
