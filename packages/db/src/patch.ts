// Import MẶC ĐỊNH rồi tách, không dùng named import: `fast-json-patch@3` là
// CommonJS, và Node ESM không suy ra được named export từ nó —
// "does not provide an export named 'applyPatch'" ở runtime. Vitest che lỗi
// này bằng lớp interop của nó, nên chỉ khi chạy thật mới lộ ra.
import jsonpatch, { type Operation } from 'fast-json-patch'
import { ProfileSchema, type Profile, type PatchOp } from '@hr/schema'

const { applyPatch, compare } = jsonpatch

/**
 * Áp JSON Patch lên Profile — TDD §8.3, UC-24, UC-53.
 *
 * Nguyên tắc BR-24.1: thay đổi của NGƯỜI và của AI đi qua CÙNG đường ống này
 * → một lịch sử undo duy nhất, không cần hai cơ chế song song.
 *
 * Mọi kết quả đều được validate lại bằng ProfileSchema: patch hợp lệ về mặt
 * RFC 6902 vẫn có thể tạo ra Profile sai (ví dụ xoá `basics.name`).
 */

export interface ApplyResult {
  ok: true
  profile: Profile
  /** Patch nghịch đảo — dùng cho undo O(1) (BR-54.1) */
  inverse: Operation[]
  applied: PatchOp[]
  /** Op bị bỏ vì không hợp lệ — UC-53 luồng thay thế 6a */
  rejected: { op: PatchOp; reason: string }[]
}

export interface ApplyFailure {
  ok: false
  reason: string
  rejected: { op: PatchOp; reason: string }[]
}

/** Bỏ metadata riêng của hệ thống, giữ đúng phần RFC 6902 */
function toRfc(op: PatchOp): Operation {
  const base = { op: op.op, path: op.path } as Record<string, unknown>
  if (op.op === 'add' || op.op === 'replace') base['value'] = op.value
  if (op.op === 'move') base['from'] = op.from
  return base as unknown as Operation
}

/**
 * Áp từng op MỘT CÁCH ĐỘC LẬP: một op hỏng không kéo đổ cả patch.
 * UC-53 6a — "op không hợp lệ → bỏ riêng op đó, áp dụng phần còn lại".
 */
export function applyProfilePatch(
  profile: Profile,
  ops: PatchOp[],
): ApplyResult | ApplyFailure {
  const before = structuredClone(profile) as Profile
  let current = structuredClone(profile) as unknown
  const applied: PatchOp[] = []
  const rejected: { op: PatchOp; reason: string }[] = []

  for (const op of ops) {
    if (op.op === 'move' && !op.from) {
      rejected.push({ op, reason: 'op "move" thiếu trường "from"' })
      continue
    }
    if ((op.op === 'add' || op.op === 'replace') && op.value === undefined) {
      rejected.push({ op, reason: `op "${op.op}" thiếu "value"` })
      continue
    }
    try {
      const next = applyPatch(structuredClone(current), [toRfc(op)], true, false).newDocument
      // Validate NGAY sau mỗi op: patch đúng RFC vẫn có thể phá schema
      const check = ProfileSchema.safeParse(next)
      if (!check.success) {
        rejected.push({
          op,
          reason: `phá schema: ${check.error.issues[0]?.path.join('.')} — ${check.error.issues[0]?.message}`,
        })
        continue
      }
      current = check.data
      applied.push(op)
    } catch (err) {
      rejected.push({ op, reason: (err as Error).message.slice(0, 140) })
    }
  }

  if (applied.length === 0) {
    return { ok: false, reason: 'Không op nào áp dụng được', rejected }
  }

  const after = current as Profile
  return {
    ok: true,
    profile: after,
    inverse: compare(after, before),
    applied,
    rejected,
  }
}

/** Dựng lại Profile ở một thời điểm bằng cách replay patch (TDD §7.2) */
export function replay(base: Profile, patches: Operation[][]): Profile {
  let doc = structuredClone(base) as unknown
  for (const p of patches) {
    doc = applyPatch(doc, p, false, false).newDocument
  }
  return ProfileSchema.parse(doc)
}

/**
 * Đánh dấu các field vừa bị AI sửa là CHƯA XÁC NHẬN (UC-53, TC-53-08).
 * Người dùng phải tự xác nhận thì mới thành `verified`.
 */
export function markUnverified(profile: Profile, ops: PatchOp[]): Profile {
  const v = { ...profile._meta.verified }
  for (const op of ops) {
    if (op.op === 'remove') delete v[op.path]
    else v[op.path] = false
  }
  return { ...profile, _meta: { ...profile._meta, verified: v } }
}

/** Người dùng sửa tay → coi như đã xác nhận (BR-24.2) */
export function markVerified(profile: Profile, ops: PatchOp[]): Profile {
  const v = { ...profile._meta.verified }
  for (const op of ops) {
    if (op.op === 'remove') delete v[op.path]
    else v[op.path] = true
  }
  return { ...profile, _meta: { ...profile._meta, verified: v } }
}

export type { Operation }
