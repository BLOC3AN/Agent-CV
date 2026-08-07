'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { FieldProps } from '@hr/templates'
import { useEditor } from '@/lib/editor-store'

/**
 * Editable — ô sửa inline ngay trên bản xem trước (FRONTEND.md §3.1, §9.4).
 *
 * Template chỉ khai báo `path`; toàn bộ logic sửa nằm ở đây. Nhờ vậy thêm
 * template mới không phải viết lại gì.
 *
 * Bàn phím (TC-A11Y-01): Tab di chuyển · Enter vào sửa · Ctrl+Enter hoặc blur
 * để lưu · Escape huỷ. Dùng được hoàn toàn không cần chuột.
 */

/** Đọc giá trị tại JSON Pointer */
function readPath(doc: unknown, path: string): unknown {
  let cur = doc
  for (const raw of path.split('/').slice(1)) {
    const p = raw.replace(/~1/g, '/').replace(/~0/g, '~')
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}

const DEBOUNCE_MS = 400

export function Editable({
  path,
  children,
  multiline = false,
  placeholder,
  className,
  as = 'span',
}: FieldProps) {
  const profile = useEditor((s) => s.profile)
  const applyUser = useEditor((s) => s.applyUser)
  const setActivePath = useEditor((s) => s.setActivePath)

  const ref = useRef<HTMLElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [editing, setEditing] = useState(false)

  const original = String(readPath(profile, path) ?? '')
  // Nội dung do AI sinh mà user chưa xác nhận → dấu ⚪ (FRONTEND.md §3.3)
  const unverified = profile?._meta.verified[path] === false

  const commit = useCallback(
    (next: string) => {
      if (next === original) return
      void applyUser([
        {
          op: 'replace',
          path,
          value: next,
          rationale: 'Người dùng sửa trực tiếp trên bản xem trước',
          grounding: { type: 'user_message', ref: 'inline-edit' },
          kbRefs: [],
        },
      ])
    },
    [applyUser, original, path],
  )

  // TC-24-02: gõ 20 ký tự trong 1s chỉ sinh 1 patch, không phải 20
  const scheduleCommit = useCallback(
    (next: string) => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => commit(next), DEBOUNCE_MS)
    },
    [commit],
  )

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const Tag = as as 'span'

  return (
    <Tag
      ref={ref as React.Ref<HTMLSpanElement>}
      className={className}
      data-editable={path}
      data-unverified={unverified ? 'true' : undefined}
      contentEditable={editing}
      suppressContentEditableWarning
      tabIndex={0}
      role="textbox"
      aria-label={placeholder ?? path}
      aria-multiline={multiline}
      onFocus={() => {
        setEditing(true)
        setActivePath(path)
      }}
      onBlur={(e) => {
        if (timer.current) clearTimeout(timer.current)
        setEditing(false)
        setActivePath(null)
        commit(e.currentTarget.textContent ?? '')
      }}
      onInput={(e) => scheduleCommit(e.currentTarget.textContent ?? '')}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          // TC-24-06: huỷ, KHÔNG phát patch
          e.preventDefault()
          if (timer.current) clearTimeout(timer.current)
          if (ref.current) ref.current.textContent = original
          setEditing(false)
          ;(e.currentTarget as HTMLElement).blur()
          return
        }
        if (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          ;(e.currentTarget as HTMLElement).blur()
        }
      }}
    >
      {children}
    </Tag>
  )
}

/** Renderer cắm vào FieldProvider của @hr/templates */
export const editableRenderer = (props: FieldProps) => <Editable {...props} />
