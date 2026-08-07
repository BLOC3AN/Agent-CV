'use client'

import { useEffect } from 'react'
import { useEditor } from '@/lib/editor-store'

/**
 * Hoàn tác / Làm lại — UC-54.
 *
 * BR-54.1: hoạt động ĐỒNG NHẤT cho thay đổi của người và của AI, vì cả hai
 * cùng đi qua một stack patch duy nhất.
 */
export function UndoRedo() {
  const undo = useEditor((s) => s.undo)
  const redo = useEditor((s) => s.redo)
  const canUndo = useEditor((s) => s.undoStack.length > 0)
  const canRedo = useEditor((s) => s.redoStack.length > 0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod || e.key.toLowerCase() !== 'z') return
      // Không cướp phím khi đang gõ trong ô sửa inline
      const el = document.activeElement as HTMLElement | null
      if (el?.isContentEditable || el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA') return
      e.preventDefault()
      void (e.shiftKey ? redo() : undo())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  const cls =
    'rounded px-2 py-1 text-sm text-neutral-600 hover:bg-neutral-100 disabled:opacity-30'

  return (
    <div className="flex gap-0.5">
      <button type="button" onClick={() => void undo()} disabled={!canUndo}
        className={cls} title="Hoàn tác (Ctrl+Z)" aria-label="Hoàn tác">↶</button>
      <button type="button" onClick={() => void redo()} disabled={!canRedo}
        className={cls} title="Làm lại (Ctrl+Shift+Z)" aria-label="Làm lại">↷</button>
    </div>
  )
}

/** Trạng thái lưu — TC-24-03 cần thấy rõ khi rollback */
export function SaveStatus() {
  const state = useEditor((s) => s.saveState)
  const error = useEditor((s) => s.lastError)

  if (state === 'saving') return <span className="text-xs text-neutral-400">Đang lưu…</span>
  if (state === 'error') {
    return (
      <span className="text-xs text-red-600" role="alert">
        Chưa lưu được{error ? ` — ${error}` : ''}
      </span>
    )
  }
  return <span className="text-xs text-neutral-400">Đã lưu</span>
}
