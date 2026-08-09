/**
 * Một chỗ duy nhất trả lời câu hỏi: "`data_v2` này có dựng lại được `data` gốc
 * không?"
 *
 * Dùng CHUNG giữa `roundtrip-check.ts` (chứng minh chỉ-đọc, chạy sau) và
 * `backfill-v2.ts` (kiểm TRƯỚC KHI ghi từng hàng) — cùng lý do đã viết ở
 * unknown-keys.ts: hai bản copy sẽ trôi khỏi nhau, và trôi trong im lặng, đúng
 * thứ toàn bộ migration này chống. Quan trọng hơn: chỉ khi hai bên dùng CÙNG
 * một phép so, câu "không hàng data_v2 nào không lùi được có thể tồn tại" mới
 * là tính chất của cấu trúc chứ không phải của quy trình vận hành.
 *
 * So với RAW `data`, KHÔNG so với `ProfileSchema.parse(data)`: bản đã parse đã
 * bị Zod strip khoá lạ trước khi so, nên hai bên "khớp" giả tạo trong khi dữ
 * liệu thật đã mất — đúng lỗi đã làm biến mất `basics.summary` của hai hồ sơ.
 */
import { CVSchema, cvToProfile } from '@hr/schema'
import { reattachUnknownKeys } from './unknown-keys.js'

/** Sắp xếp khoá ở mọi cấp: so sánh phải độc lập với thứ tự khoá của jsonb. */
export function canon(v: unknown): unknown {
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

export const canonicalJSON = (v: unknown): string => JSON.stringify(canon(v))

export function firstDiff(a: string, b: string): string {
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

/**
 * v2 → v1 đầy đủ: parse, chuyển đổi, rồi gắn lại khoá mà ProfileSchema không
 * biết tới. Bước gắn lại phải nằm SAU cùng và không được parse lại — parse lại
 * strip đúng những field vừa gắn.
 */
export function restoreFromV2(dataV2: unknown): Record<string, unknown> {
  const cv = CVSchema.parse(dataV2)
  return reattachUnknownKeys(cvToProfile(cv), cv._meta.droppedFields)
}

/**
 * `null` = `data_v2` dựng lại đúng `raw`. Ngược lại trả về mô tả chỗ lệch.
 *
 * Lỗi khi dựng lại (CVSchema/cvToProfile ném) cũng là "không chứng minh được
 * đường lùi nguyên vẹn" — trả về mô tả, không để ngoại lệ lọt ra ngoài và làm
 * chết vòng lặp đang duyệt các hàng khác.
 */
export function diffRestored(raw: unknown, dataV2: unknown): string | null {
  let restored: unknown
  try {
    restored = restoreFromV2(dataV2)
  } catch (err) {
    return `lỗi khi dựng lại: ${(err as Error).message}`
  }
  const a = canonicalJSON(raw)
  const b = canonicalJSON(restored)
  return a === b ? null : `data khôi phục từ data_v2 KHÔNG khớp raw\n${firstDiff(a, b)}`
}

/**
 * Bản ném lỗi của `diffRestored`, dành cho backfill: gọi TRƯỚC mỗi UPDATE để
 * không hàng `data_v2` nào chưa chứng minh được đường lùi có thể được ghi
 * xuống. Ném lỗi thay vì trả về cờ để nó rơi thẳng vào `catch` đã có của
 * backfill và được ghi kèm id hàng như mọi thất bại khác.
 */
export function assertReversible(raw: unknown, dataV2: unknown): void {
  const diff = diffRestored(raw, dataV2)
  if (diff) throw new Error(`không khôi phục lại được data từ data_v2 vừa dựng — ${diff}`)
}
