import React, { useState } from 'react'
import { ChevronDown, ChevronRight, Eye, EyeOff, GripVertical } from 'lucide-react'
import type { CV, CVLayout, CVNodeType, LayoutNode } from '../types'

interface ComponentTreeProps {
  cv: CV
  layout: CVLayout
  selectedNodeId?: string
  onMoveNode: (nodeId: string, beforeNodeId: string | null) => void
  onMoveItem: (nodeId: string, itemId: string, beforeItemId: string | null) => void
  onSetNodeVisible: (nodeId: string, visible: boolean) => void
  onSelect?: (nodeId: string, itemId?: string) => void
  onEdit?: (nodeId: string, itemId?: string) => void
}

type Dragged = { kind: 'node'; nodeId: string } | { kind: 'item'; nodeId: string; itemId: string } | null

const labels: Record<CVNodeType, string> = {
  header: 'Thông tin cá nhân', summary: 'Giới thiệu bản thân', experience: 'Kinh nghiệm làm việc', projects: 'Dự án nổi bật', education: 'Học vấn & Bằng cấp', skills: 'Kỹ năng & Công nghệ', certifications: 'Chứng chỉ', languages: 'Ngoại ngữ', footer: 'Footer',
}

function nestedItems(cv: CV, node: LayoutNode): Array<{ id: string; label: string }> {
  if (node.type === 'experience') return cv.sections.experience.map((item) => ({ id: item.id, label: `${item.title} — ${item.company}` }))
  if (node.type === 'projects') return cv.sections.projects.map((item) => ({ id: item.id, label: item.name }))
  if (node.type === 'education') return cv.sections.education.map((item) => ({ id: item.id, label: item.school }))
  return []
}

function orderedNestedItems(cv: CV, node: LayoutNode) {
  const items = nestedItems(cv, node)
  if (!('itemOrder' in node) || !node.itemOrder?.length) return items
  const byId = new Map(items.map((item) => [item.id, item]))
  const ordered = node.itemOrder.flatMap((id) => byId.get(id) ?? [])
  const ids = new Set(ordered.map((item) => item.id))
  return [...ordered, ...items.filter((item) => !ids.has(item.id))]
}

export function ComponentTree({ cv, layout, selectedNodeId, onMoveNode, onMoveItem, onSetNodeVisible, onSelect, onEdit }: ComponentTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [dragged, setDragged] = useState<Dragged>(null)
  const toggleExpanded = (nodeId: string) => setExpanded((current) => {
    const next = new Set(current)
    if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId)
    return next
  })

  return (
    <div role="tree" aria-label="Cấu trúc CV" className="space-y-1">
      {layout.nodes.map((node) => {
        const items = orderedNestedItems(cv, node)
        const expandable = items.length > 0
        const isExpanded = expanded.has(node.id)
        const label = labels[node.type]
        return (
          <div key={node.id}>
            <div
              role="treeitem"
              aria-label={label}
              aria-selected={selectedNodeId === node.id}
              className={`group flex items-center gap-1 rounded-lg border px-1.5 py-1.5 text-xs transition ${node.visible ? 'border-slate-200 bg-white text-slate-700' : 'border-slate-200 bg-slate-50 text-slate-400'} ${selectedNodeId === node.id ? 'ring-1 ring-indigo-400' : ''}`}
              onClick={() => onSelect?.(node.id)}
              onDoubleClick={() => onEdit?.(node.id)}
              onDragOver={(event) => { if (dragged?.kind === 'node' && dragged.nodeId !== node.id) event.preventDefault() }}
              onDrop={(event) => { event.preventDefault(); if (dragged?.kind === 'node' && dragged.nodeId !== node.id) onMoveNode(dragged.nodeId, node.id); setDragged(null) }}
            >
              <button type="button" draggable aria-label={`Kéo ${label}`} className="cursor-grab rounded p-0.5 text-slate-400 hover:text-slate-700 active:cursor-grabbing" onClick={(event) => event.stopPropagation()} onDragStart={() => setDragged({ kind: 'node', nodeId: node.id })} onDragEnd={() => setDragged(null)}><GripVertical className="h-3.5 w-3.5" /></button>
              {expandable ? <button type="button" aria-label={`${isExpanded ? 'Thu gọn' : 'Mở rộng'} ${label}`} className="rounded p-0.5 hover:bg-slate-100" onClick={(event) => { event.stopPropagation(); toggleExpanded(node.id) }}>{isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</button> : <span className="w-5" />}
              <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
              <button type="button" aria-label={`${node.visible ? 'Ẩn' : 'Hiện'} ${label}`} className="rounded p-1 hover:bg-slate-100" onClick={(event) => { event.stopPropagation(); onSetNodeVisible(node.id, !node.visible) }}>{node.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}</button>
            </div>
            {expandable && isExpanded && <div role="group" className="ml-6 mt-1 space-y-1 border-l border-slate-200 pl-2">{items.map((item) => <div key={item.id} role="treeitem" aria-label={item.label} className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-slate-600 hover:bg-slate-50" onClick={() => onSelect?.(node.id, item.id)} onDoubleClick={() => onEdit?.(node.id, item.id)} onDragOver={(event) => { if (dragged?.kind === 'item' && dragged.nodeId === node.id && dragged.itemId !== item.id) { event.preventDefault(); event.stopPropagation() } }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); if (dragged?.kind === 'item' && dragged.nodeId === node.id && dragged.itemId !== item.id) onMoveItem(node.id, dragged.itemId, item.id); setDragged(null) }}><button type="button" draggable aria-label={`Kéo ${item.label}`} className="cursor-grab rounded p-0.5 text-slate-400 hover:text-slate-700 active:cursor-grabbing" onClick={(event) => event.stopPropagation()} onDragStart={() => setDragged({ kind: 'item', nodeId: node.id, itemId: item.id })} onDragEnd={() => setDragged(null)}><GripVertical className="h-3 w-3" /></button><span className="truncate">{item.label}</span></div>)}<div aria-label={`Thả để chuyển ${label} xuống cuối`} className="h-2 rounded border border-dashed border-transparent" onDragOver={(event) => { if (dragged?.kind === 'item' && dragged.nodeId === node.id) { event.preventDefault(); event.stopPropagation() } }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); if (dragged?.kind === 'item' && dragged.nodeId === node.id) onMoveItem(node.id, dragged.itemId, null); setDragged(null) }} /></div>}
          </div>
        )
      })}
      <div aria-label="Thả để chuyển node xuống cuối" className="h-2 rounded border border-dashed border-transparent" onDragOver={(event) => { if (dragged?.kind === 'node') event.preventDefault() }} onDrop={(event) => { event.preventDefault(); if (dragged?.kind === 'node') onMoveNode(dragged.nodeId, null); setDragged(null) }} />
    </div>
  )
}
