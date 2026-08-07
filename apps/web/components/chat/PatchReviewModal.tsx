'use client'

import { useMemo, useState } from 'react'
import type { PatchOp, Profile } from '@hr/schema'

/**
 * Duyệt đề xuất của AI — UC-53, TDD §8.3.
 *
 * BR-53.1: **AI không bao giờ ghi thẳng vào hồ sơ.** Mọi thay đổi đi qua đây.
 *
 * Op có nguồn từ người dùng / field sẵn có / tri thức HR → tick sẵn.
 * Op AI TỰ SUY RA → viền vàng, KHÔNG tick sẵn. Ranh giới này vừa tạo niềm tin
 * vừa là công cụ gỡ lỗi: lời khuyên sai thì biết ngay nó đến từ đâu.
 */

export interface ProposalData {
  proposalId: string
  summary: string
  ops: PatchOp[]
  rejected: { path: string; reason: string }[]
}

const GROUNDING_LABEL: Record<string, { text: string; tone: 'ok' | 'warn' }> = {
  user_message: { text: 'Theo thông tin bạn vừa cung cấp', tone: 'ok' },
  existing_field: { text: 'Viết lại từ nội dung sẵn có', tone: 'ok' },
  kb: { text: 'Theo hướng dẫn của chuyên gia HR', tone: 'ok' },
  inference: { text: 'AI tự suy luận — bạn kiểm kỹ giúp nhé', tone: 'warn' },
}

/** Op nào được tick sẵn — chỉ những op có nguồn kiểm chứng được (UC-53 bước 2-3). */
export function defaultChecked(ops: PatchOp[]): number[] {
  return ops
    .map((op, i) => (op.grounding.type === 'inference' ? -1 : i))
    .filter((i) => i >= 0)
}

/** Đọc giá trị hiện tại tại một JSON Pointer để hiện diff "trước → sau". */
export function readAt(profile: Profile, pointer: string): string {
  const parts = pointer.split('/').slice(1).map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'))
  let node: unknown = profile
  for (const key of parts) {
    if (key === '-' || node === null || typeof node !== 'object') return ''
    node = Array.isArray(node) ? node[Number(key)] : (node as Record<string, unknown>)[key]
    if (node === undefined) return ''
  }
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' · ')
  return node === null ? '' : JSON.stringify(node)
}

function preview(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' · ')
  }
  return value === undefined ? '' : JSON.stringify(value)
}

interface Props {
  data: ProposalData
  profile: Profile
  profileId: string
  onApplied: (profile: Profile, applied: number) => void
  onDismiss: () => void
}

export function PatchReviewModal({ data, profile, profileId, onApplied, onDismiss }: Props) {
  const [checked, setChecked] = useState<number[]>(() => defaultChecked(data.ops))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const inferenceCount = useMemo(
    () => data.ops.filter((o) => o.grounding.type === 'inference').length,
    [data.ops],
  )

  const toggle = (i: number): void =>
    setChecked((c) => (c.includes(i) ? c.filter((x) => x !== i) : [...c, i]))

  const submit = async (accept: number[]): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/chat/proposals/${data.proposalId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId, accept }),
      })
      const json = (await res.json()) as {
        profile?: Profile
        applied?: number
        error?: string
      }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)

      if (accept.length === 0) onDismiss()
      else onApplied(json.profile!, json.applied ?? 0)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Duyệt đề xuất thay đổi"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
    >
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl dark:bg-neutral-900">
        <h2 className="text-lg font-semibold">Trợ lý đề xuất {data.ops.length} thay đổi</h2>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{data.summary}</p>

        {inferenceCount > 0 && (
          <p className="mt-3 rounded border border-amber-300 bg-amber-50 p-2 text-sm dark:border-amber-800 dark:bg-amber-950/30">
            {inferenceCount} thay đổi do AI tự suy luận, chưa được tick sẵn. Bạn đọc kỹ
            rồi hãy chọn.
          </p>
        )}

        <ul className="mt-4 space-y-3">
          {data.ops.map((op, i) => {
            const g = GROUNDING_LABEL[op.grounding.type] ?? {
              text: op.grounding.type,
              tone: 'warn' as const,
            }
            const before = readAt(profile, op.path)
            const after = preview(op.value)

            return (
              <li
                key={`${op.path}-${i}`}
                className={[
                  'rounded-lg border p-3',
                  g.tone === 'warn'
                    ? 'border-amber-300 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20'
                    : 'border-neutral-200 dark:border-neutral-700',
                ].join(' ')}
              >
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={checked.includes(i)}
                    onChange={() => toggle(i)}
                    className="mt-1"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-xs text-neutral-500">{op.path}</div>

                    {op.op !== 'add' && before && (
                      <p className="mt-1 text-sm text-neutral-500 line-through">{before}</p>
                    )}
                    {op.op === 'remove' ? (
                      <p className="mt-1 text-sm text-red-600">(xoá)</p>
                    ) : (
                      <p className="mt-1 text-sm">{after}</p>
                    )}

                    <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">
                      {op.rationale}
                    </p>
                    <p
                      className={[
                        'mt-1 text-xs',
                        g.tone === 'warn' ? 'text-amber-700 dark:text-amber-400' : 'text-neutral-500',
                      ].join(' ')}
                    >
                      {g.text}
                    </p>
                  </div>
                </label>
              </li>
            )
          })}
        </ul>

        {data.rejected.length > 0 && (
          <details className="mt-4 text-sm text-neutral-500">
            <summary className="cursor-pointer">
              {data.rejected.length} đề xuất bị loại vì không áp dụng được
            </summary>
            <ul className="mt-2 space-y-1 pl-4">
              {data.rejected.map((r, i) => (
                <li key={i}>
                  <code className="text-xs">{r.path}</code> — {r.reason}
                </li>
              ))}
            </ul>
          </details>
        )}

        {error && (
          <p role="alert" className="mt-3 rounded border border-red-300 bg-red-50 p-2 text-sm">
            {error}
          </p>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void submit(checked)}
            disabled={busy || checked.length === 0}
            className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {busy ? 'Đang áp dụng…' : `Áp dụng ${checked.length} mục đã chọn`}
          </button>
          <button
            type="button"
            onClick={() => void submit([])}
            disabled={busy}
            className="rounded border border-neutral-300 px-4 py-2 text-sm dark:border-neutral-600"
          >
            Bỏ qua tất cả
          </button>
        </div>
      </div>
    </div>
  )
}
