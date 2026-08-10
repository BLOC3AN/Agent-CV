import type { ChatOp } from './api'
import { CVLayoutSchema, CVSchema } from '@hr/schema'
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

const introFields = new Set(['fullName', 'title', 'email', 'phone', 'location', 'website', 'summary', 'careerObjective', 'availability', 'avatarUrl'])
const designFields = new Set(['template', 'accentColor', 'font', 'fontSize', 'spacing'])
const sectionFields: Record<string, Set<string>> = {
  experience: new Set(['id', 'title', 'company', 'startDate', 'endDate', 'current', 'teamSize', 'techStack', 'highlights']),
  projects: new Set(['id', 'name', 'role', 'startDate', 'endDate', 'link', 'teamSize', 'techStack', 'contribution', 'highlights']),
  education: new Set(['id', 'school', 'degree', 'fieldOfStudy', 'startDate', 'endDate', 'gpa', 'highlights']),
  skills: new Set(['id', 'category', 'skills']),
  activities: new Set(['id', 'organization', 'role', 'startDate', 'endDate', 'highlights']),
  certifications: new Set(['id', 'name', 'issuer', 'date', 'link']),
  languages: new Set(['id', 'language', 'proficiency']),
}

function assertAllowedOperation(operation: ChatOp, parts: string[]): void {
  const op = operation.op
  let allowed = false
  if (parts[0] === 'sections' && parts[1] === 'intro' && parts.length === 3) {
    allowed = introFields.has(parts[2]!)
  } else if (parts[0] === 'sections' && sectionFields[parts[1] ?? '']) {
    const fields = sectionFields[parts[1]!]!
    const itemIndex = parts[2]
    if (parts.length === 3) allowed = itemIndex === '-' ? op === 'add' : /^\d+$/.test(itemIndex ?? '')
    else if (/^\d+$/.test(itemIndex ?? '') && parts.length === 4) allowed = fields.has(parts[3]!)
    else if (/^\d+$/.test(itemIndex ?? '') && parts.length === 5 && (parts[3] === 'highlights' || parts[3] === 'skills' || parts[3] === 'techStack')) {
      allowed = parts[4] === '-' ? op === 'add' : /^\d+$/.test(parts[4] ?? '')
    }
  } else if (parts[0] === 'design' && parts.length === 2) {
    allowed = designFields.has(parts[1]!)
  } else if (parts[0] === 'layout' && parts[1] === 'nodes') {
    if (parts.length === 2) allowed = op === 'replace'
    else if (/^\d+$/.test(parts[2] ?? '') && parts.length === 4 && parts[3] === 'visible') allowed = op === 'replace'
    else if (/^\d+$/.test(parts[2] ?? '') && parts[3] === 'itemOrder') {
      if (parts.length === 4) allowed = op === 'add' || op === 'replace'
      else if (parts.length === 5) allowed = parts[4] === '-' ? op === 'add' : /^\d+$/.test(parts[4] ?? '')
    }
  }
  if (!allowed) throw new Error(`Đường dẫn JSON Patch không được phép: ${operation.path}`)
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
    assertAllowedOperation(operation, parts)
    if (parts[0] === 'layout') {
      if (parts.length === 1) throw new Error('Không thể thay thế toàn bộ bố cục từ đề xuất AI')
      applyOperation(result.layout, { ...operation, path: `/${parts.slice(1).map((part) => part.replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}` })
      layoutChanged = true
    } else {
      applyOperation(result.cv, operation)
    }
  }
  const parsedLayout = CVLayoutSchema.safeParse(result.layout)
  if (layoutChanged && !parsedLayout.success) throw new Error('Bố cục từ JSON Patch không hợp lệ')
  const parsedCV = CVSchema.safeParse(result.cv)
  if (!parsedCV.success) throw new Error('CV từ JSON Patch không hợp lệ')
  return {
    cv: parsedCV.data as CV,
    layout: (parsedLayout.success ? parsedLayout.data : result.layout) as CVLayout,
  }
}
