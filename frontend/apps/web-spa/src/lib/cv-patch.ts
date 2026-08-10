import type { ChatOp } from './api'
import type { CV } from '../types'

function pointerParts(path: string): string[] {
  if (path === '') return []
  if (!path.startsWith('/')) throw new Error(`Đường dẫn patch không hợp lệ: ${path}`)
  return path.slice(1).split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
}

/** Applies AI operations immutably to the editor's draft only. */
export function applyChatOps(cv: CV, ops: ChatOp[]): CV {
  const result = structuredClone(cv) as unknown
  for (const operation of ops) {
    const parts = pointerParts(operation.path)
    if (parts.length === 0) throw new Error('Không thể thay thế toàn bộ CV từ đề xuất AI')
    let parent: unknown = result
    for (const part of parts.slice(0, -1)) {
      if (parent === null || typeof parent !== 'object') throw new Error(`Không tìm thấy đường dẫn ${operation.path}`)
      parent = Array.isArray(parent) ? parent[Number(part)] : (parent as Record<string, unknown>)[part]
    }
    if (parent === null || typeof parent !== 'object') throw new Error(`Không tìm thấy đường dẫn ${operation.path}`)
    const key = parts.at(-1)!
    if (Array.isArray(parent)) {
      const index = key === '-' ? parent.length : Number(key)
      if (!Number.isInteger(index) || index < 0 || index > parent.length || (operation.op !== 'add' && index >= parent.length)) throw new Error(`Chỉ số patch không hợp lệ: ${operation.path}`)
      if (operation.op === 'add') parent.splice(index, 0, operation.value)
      else if (operation.op === 'remove') parent.splice(index, 1)
      else parent[index] = operation.value
    } else {
      const record = parent as Record<string, unknown>
      if (operation.op === 'remove') delete record[key]
      else record[key] = operation.value
    }
  }
  return result as CV
}
