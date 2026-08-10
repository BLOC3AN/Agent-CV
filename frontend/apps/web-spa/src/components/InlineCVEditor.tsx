import React, { useState } from 'react'
import { FieldCatalog } from './FieldCatalog'
import { getCVFieldDraftValue, updateCVFieldDraft, type CVFieldDraftValue } from '../lib/cv-store'
import { validateCVFieldPlacement } from '../lib/cv-fields'
import type { CV, CVFieldDefinition, LayoutNode } from '../types'

interface InlineCVEditorProps {
  node: LayoutNode
  item?: { id: string }
  fieldDefinitions: readonly CVFieldDefinition[]
  draft: CV
  onDraftChange: (draft: CV) => void
  onClose: () => void
}

function initialKeys(node: LayoutNode): string[] {
  if (node.type === 'experience') return ['role']
  if (node.type === 'projects') return ['name']
  if (node.type === 'education') return ['school']
  return []
}

function initialValues(draft: CV, node: LayoutNode, itemId: string | undefined, keys: string[]) {
  return Object.fromEntries(keys.map((key) => [key, getCVFieldDraftValue(draft, node, itemId, key)])) as Record<string, CVFieldDraftValue>
}

const nodeLabels: Record<LayoutNode['type'], string> = {
  header: 'Thông tin cá nhân', summary: 'Giới thiệu bản thân', experience: 'Kinh nghiệm làm việc', projects: 'Dự án nổi bật', education: 'Học vấn & Bằng cấp', skills: 'Kỹ năng & Công nghệ', certifications: 'Chứng chỉ', languages: 'Ngoại ngữ', footer: 'Footer',
}

export function InlineCVEditor({ node, item, fieldDefinitions, draft, onDraftChange, onClose }: InlineCVEditorProps) {
  const [keys, setKeys] = useState(() => initialKeys(node))
  const [values, setValues] = useState<Record<string, CVFieldDraftValue>>(() => initialValues(draft, node, item?.id, initialKeys(node)))
  const definitions = keys.flatMap((key) => {
    const definition = fieldDefinitions.find((field) => field.key === key)
    if (!definition) return []
    try {
      validateCVFieldPlacement(key, node.type)
      return [definition]
    } catch {
      return []
    }
  })

  const addField = (key: string) => {
    if (keys.includes(key)) return
    const value = getCVFieldDraftValue(draft, node, item?.id, key)
    setKeys((current) => [...current, key])
    setValues((current) => ({ ...current, [key]: value }))
  }
  const apply = () => {
    const next = definitions.reduce((current, definition) => updateCVFieldDraft(current, node, item?.id, definition.key, values[definition.key] ?? ''), draft)
    onDraftChange(next)
    onClose()
  }
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
    const textarea = event.target instanceof HTMLTextAreaElement
    if (event.key === 'Enter' && (!textarea || event.ctrlKey || event.metaKey)) { event.preventDefault(); apply() }
  }
  const setValue = (key: string, value: CVFieldDraftValue) => setValues((current) => ({ ...current, [key]: value }))

  return <div role="dialog" aria-modal="false" aria-label={`Chỉnh sửa ${nodeLabels[node.type]}`} onKeyDown={onKeyDown} className="mt-4 space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-2xs">
    <div className="flex items-center justify-between border-b border-slate-200 pb-2">
      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900">Chỉnh sửa: {nodeLabels[node.type]}</h4>
      <button type="button" aria-label="Đóng trình sửa nội tuyến" onClick={onClose} className="rounded-md p-1 text-slate-500 hover:bg-slate-200">×</button>
    </div>
    {definitions.map((definition) => <FieldControl key={definition.key} definition={definition} value={values[definition.key] ?? ''} onChange={(value) => setValue(definition.key, value)} />)}
    <FieldCatalog node={node} fieldDefinitions={fieldDefinitions} selectedKeys={keys} onAdd={addField} />
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200">Hủy</button>
      <button type="button" onClick={apply} className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-indigo-700">Cập nhật bản nháp</button>
    </div>
  </div>
}

function FieldControl({ definition, value, onChange }: { definition: CVFieldDefinition; value: CVFieldDraftValue; onChange: (value: CVFieldDraftValue) => void }) {
  const className = 'w-full rounded-lg border border-slate-200 bg-white p-2 text-xs font-medium focus:border-indigo-500 focus:outline-none'
  if (definition.valueType === 'multiline') return <label className="block text-xs font-semibold text-slate-700">{definition.label}<textarea aria-label={definition.label} rows={3} value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)} className={`${className} mt-1`} /></label>
  if (definition.valueType === 'date') {
    const range = typeof value === 'object' && !Array.isArray(value) ? value : { start: '', end: '' }
    return <fieldset className="space-y-1"><legend className="text-xs font-semibold text-slate-700">{definition.label}</legend><div className="grid grid-cols-2 gap-2"><label className="text-[11px] text-slate-600">Start time<input aria-label="Start time" value={range.start} onChange={(event) => onChange({ ...range, start: event.target.value })} className={`${className} mt-1`} /></label><label className="text-[11px] text-slate-600">End time<input aria-label="End time" value={range.end} onChange={(event) => onChange({ ...range, end: event.target.value })} className={`${className} mt-1`} /></label></div></fieldset>
  }
  if (definition.valueType === 'tag-list') {
    const tags = Array.isArray(value) ? value : []
    return <label className="block text-xs font-semibold text-slate-700">{definition.label}<input aria-label={definition.label} value={tags.join(', ')} onChange={(event) => onChange(event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean))} className={`${className} mt-1`} /><span className="mt-1 block text-[10px] font-normal text-slate-500">Ngăn cách thẻ bằng dấu phẩy.</span></label>
  }
  return <label className="block text-xs font-semibold text-slate-700">{definition.label}<input aria-label={definition.label} value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)} className={`${className} mt-1`} /></label>
}
