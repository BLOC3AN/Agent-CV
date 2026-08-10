import type { ChatOp } from './api'
import { CVLayoutSchema } from '@hr/schema'
import type { CV, CVLayout } from '../types'

export interface ChatDraftDocument {
  cv: CV
  layout: CVLayout
}

function pointerParts(path: unknown): string[] {
  if (typeof path !== 'string' || path === '' || !path.startsWith('/') || /~(?:[^01]|$)/.test(path)) {
    throw new Error(`Đường dẫn JSON Patch không hợp lệ: ${String(path)}`)
  }
  return path.slice(1).split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function arrayIndex(key: string, length: number, allowAppend: boolean, path: string): number {
  if (allowAppend && key === '-') return length
  if (!/^(?:0|[1-9]\d*)$/.test(key)) throw new Error(`Chỉ số JSON Patch không hợp lệ: ${path}`)
  const index = Number(key)
  const max = allowAppend ? length : length - 1
  if (index > max) throw new Error(`Chỉ số JSON Patch không tồn tại: ${path}`)
  return index
}

function applyOperation(root: unknown, operation: ChatOp): void {
  const op = (operation as { op?: unknown }).op
  if (op !== 'add' && op !== 'replace' && op !== 'remove') throw new Error(`Op JSON Patch không được hỗ trợ: ${String(op)}`)
  if (op !== 'remove' && !Object.prototype.hasOwnProperty.call(operation, 'value')) throw new Error(`Op JSON Patch thiếu value: ${operation.path}`)

  const parts = pointerParts(operation.path)
  let parent: unknown = root
  for (const part of parts.slice(0, -1)) {
    if (Array.isArray(parent)) parent = parent[arrayIndex(part, parent.length, false, operation.path)]
    else if (isRecord(parent) && Object.prototype.hasOwnProperty.call(parent, part)) parent = parent[part]
    else throw new Error(`Đường dẫn JSON Patch không tồn tại: ${operation.path}`)
  }
  if (!Array.isArray(parent) && !isRecord(parent)) throw new Error(`Đường dẫn JSON Patch không tồn tại: ${operation.path}`)

  const key = parts.at(-1)!
  if (Array.isArray(parent)) {
    const index = arrayIndex(key, parent.length, op === 'add', operation.path)
    if (op === 'add') parent.splice(index, 0, operation.value)
    else if (op === 'remove') parent.splice(index, 1)
    else parent[index] = operation.value
    return
  }

  if (op !== 'add' && !Object.prototype.hasOwnProperty.call(parent, key)) throw new Error(`Đường dẫn JSON Patch không tồn tại: ${operation.path}`)
  if (op === 'remove') delete parent[key]
  else parent[key] = operation.value
}

/** Apply selected RFC 6902 add/replace/remove operations to a local draft only. */
export function applyChatOpsToDraft(draft: ChatDraftDocument, ops: ChatOp[]): ChatDraftDocument {
  const result = structuredClone(draft)
  let layoutChanged = false
  for (const operation of ops) {
    const parts = pointerParts(operation.path)
    if (parts[0] === 'layout') {
      if (parts.length === 1) throw new Error('Không thể thay thế toàn bộ bố cục từ đề xuất AI')
      applyOperation(result.layout, { ...operation, path: `/${parts.slice(1).map((part) => part.replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}` })
      layoutChanged = true
    } else {
      applyOperation(result.cv, operation)
    }
  }
  if (layoutChanged && !CVLayoutSchema.safeParse(result.layout).success) throw new Error('Bố cục từ JSON Patch không hợp lệ')
  return result
}
