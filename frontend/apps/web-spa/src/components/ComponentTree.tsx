import React, { useLayoutEffect, useRef, useState } from 'react'
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
type DropTarget = { kind: 'node'; beforeNodeId: string | null } | { kind: 'item'; nodeId: string; beforeItemId: string | null } | null

const labels: Record<CVNodeType, string> = {
  header: 'Thông tin cá nhân', summary: 'Giới thiệu bản thân', experience: 'Kinh nghiệm làm việc', projects: 'Dự án nổi bật', education: 'Học vấn & Bằng cấp', skills: 'Kỹ năng & Công nghệ', activities: 'Hoạt động & Ngoại khóa', certifications: 'Chứng chỉ', languages: 'Ngoại ngữ', footer: 'Footer',
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

function activateEditFromKeyboard(event: React.KeyboardEvent<HTMLElement>, onEdit: ComponentTreeProps['onEdit'], nodeId: string, itemId?: string) {
  if (event.target !== event.currentTarget) return
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  onEdit?.(nodeId, itemId)
}

export function ComponentTree({ cv, layout, selectedNodeId, onMoveNode, onMoveItem, onSetNodeVisible, onSelect, onEdit }: ComponentTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [dragged, setDragged] = useState<Dragged>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget>(null)
  const rowRefs = useRef(new Map<string, HTMLElement>())
  const previousRects = useRef(new Map<string, DOMRect>())

  useLayoutEffect(() => {
    const nextRects = new Map<string, DOMRect>()
    rowRefs.current.forEach((element, key) => nextRects.set(key, element.getBoundingClientRect()))
    const animationFrame = window.requestAnimationFrame(() => {
      nextRects.forEach((next, key) => {
        const previous = previousRects.current.get(key)
        const element = rowRefs.current.get(key)
        if (!previous || !element) return
        const deltaX = previous.left - next.left
        const deltaY = previous.top - next.top
        if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return
        element.style.transition = 'none'
        element.style.transform = `translate(${deltaX}px, ${deltaY}px)`
        window.requestAnimationFrame(() => {
          element.style.transition = 'transform 180ms ease-out'
          element.style.transform = ''
        })
      })
    })
    previousRects.current = nextRects
    return () => window.cancelAnimationFrame(animationFrame)
  })

  const resetDrag = () => {
    setDragged(null)
    setDropTarget(null)
  }
  const toggleExpanded = (nodeId: string) => setExpanded((current) => {
    const next = new Set(current)
    if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId)
    return next
  })

  const placeholder = (key: string, label: string) => (
    <div
      key={key}
      data-testid="component-tree-drop-placeholder"
      data-drop-placeholder={key}
      aria-label={`Vị trí thả ${label}`}
      className="my-1 h-9 rounded-lg border border-dashed border-indigo-400 bg-indigo-50/70 shadow-inner transition-all duration-150 ease-out"
    />
  )

  return (
    <div role="tree" aria-label="Cấu trúc CV" className="space-y-1">
      {layout.nodes.map((node) => {
        const items = orderedNestedItems(cv, node)
        const expandable = items.length > 0
        const isExpanded = expanded.has(node.id)
        const label = labels[node.type]
        const nodePlaceholder = dropTarget?.kind === 'node' && dropTarget.beforeNodeId === node.id
        return (
          <div key={node.id}>
            {nodePlaceholder && placeholder(`node:${node.id}`, label)}
            <div
              role="treeitem"
              tabIndex={0}
              aria-label={label}
              aria-selected={selectedNodeId === node.id}
              aria-expanded={expandable ? isExpanded : undefined}
              ref={(element) => { if (element) rowRefs.current.set(`node:${node.id}`, element); else rowRefs.current.delete(`node:${node.id}`) }}
              data-tree-row-key={`node:${node.id}`}
              className={`group flex items-center gap-1 rounded-lg border px-1.5 py-1.5 text-xs transition-colors ${node.visible ? 'border-slate-200 bg-white text-slate-700' : 'border-slate-200 bg-slate-50 text-slate-400'} ${selectedNodeId === node.id ? 'ring-1 ring-indigo-400' : ''} ${dropTarget?.kind === 'node' && dropTarget.beforeNodeId === node.id ? 'ring-1 ring-indigo-300' : ''}`}
              onClick={() => onSelect?.(node.id)}
              onDoubleClick={() => onEdit?.(node.id)}
              onKeyDown={(event) => activateEditFromKeyboard(event, onEdit, node.id)}
              onDragOver={(event) => { if (dragged?.kind === 'node' && dragged.nodeId !== node.id) { event.preventDefault(); setDropTarget({ kind: 'node', beforeNodeId: node.id }) } }}
              onDrop={(event) => { event.preventDefault(); if (dragged?.kind === 'node' && dragged.nodeId !== node.id) onMoveNode(dragged.nodeId, node.id); resetDrag() }}
            >
              <button type="button" draggable aria-label={`Kéo ${label}`} data-dragging={dragged?.kind === 'node' && dragged.nodeId === node.id ? 'true' : undefined} className={`cursor-grab rounded p-0.5 text-slate-400 hover:text-slate-700 active:cursor-grabbing ${dragged?.kind === 'node' && dragged.nodeId === node.id ? 'opacity-40 shadow-lg' : ''}`} onClick={(event) => event.stopPropagation()} onDragStart={() => { setDragged({ kind: 'node', nodeId: node.id }); setDropTarget(null) }} onDragEnd={resetDrag}><GripVertical className="h-3.5 w-3.5" /></button>
              {expandable ? <button type="button" aria-label={`${isExpanded ? 'Thu gọn' : 'Mở rộng'} ${label}`} className="rounded p-0.5 hover:bg-slate-100" onClick={(event) => { event.stopPropagation(); toggleExpanded(node.id) }}>{isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</button> : <span className="w-5" />}
              <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
              <button type="button" aria-label={`${node.visible ? 'Ẩn' : 'Hiện'} ${label}`} className="rounded p-1 hover:bg-slate-100" onClick={(event) => { event.stopPropagation(); onSetNodeVisible(node.id, !node.visible) }}>{node.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}</button>
            </div>
            {expandable && isExpanded && <div role="group" className="ml-6 mt-1 space-y-1 border-l border-slate-200 pl-2">
              {items.map((item) => {
                const itemPlaceholder = dropTarget?.kind === 'item' && dropTarget.nodeId === node.id && dropTarget.beforeItemId === item.id
                return <React.Fragment key={item.id}>
                  {itemPlaceholder && placeholder(`item:${node.id}:${item.id}`, item.label)}
                  <div
                    ref={(element) => { if (element) rowRefs.current.set(`item:${node.id}:${item.id}`, element); else rowRefs.current.delete(`item:${node.id}:${item.id}`) }}
                    data-tree-row-key={`item:${node.id}:${item.id}`}
                    role="treeitem"
                    tabIndex={0}
                    aria-label={item.label}
                    className={`flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-slate-600 transition-colors hover:bg-slate-50 ${dragged?.kind === 'item' && dragged.itemId === item.id ? 'opacity-40 shadow-lg' : ''}`}
                    onClick={(event) => { event.stopPropagation(); onSelect?.(node.id, item.id) }}
                    onDoubleClick={(event) => { event.stopPropagation(); onEdit?.(node.id, item.id) }}
                    onKeyDown={(event) => activateEditFromKeyboard(event, onEdit, node.id, item.id)}
                    onDragOver={(event) => { if (dragged?.kind === 'item' && dragged.nodeId === node.id && dragged.itemId !== item.id) { event.preventDefault(); event.stopPropagation(); setDropTarget({ kind: 'item', nodeId: node.id, beforeItemId: item.id }) } }}
                    onDrop={(event) => { event.preventDefault(); event.stopPropagation(); if (dragged?.kind === 'item' && dragged.nodeId === node.id && dragged.itemId !== item.id) onMoveItem(node.id, dragged.itemId, item.id); resetDrag() }}
                  >
                    <button type="button" draggable aria-label={`Kéo ${item.label}`} data-dragging={dragged?.kind === 'item' && dragged.itemId === item.id ? 'true' : undefined} className="cursor-grab rounded p-0.5 text-slate-400 hover:text-slate-700 active:cursor-grabbing" onClick={(event) => event.stopPropagation()} onDragStart={() => { setDragged({ kind: 'item', nodeId: node.id, itemId: item.id }); setDropTarget(null) }} onDragEnd={resetDrag}><GripVertical className="h-3 w-3" /></button>
                    <span className="truncate">{item.label}</span>
                  </div>
                </React.Fragment>
              })}
              <div aria-label={`Thả để chuyển ${label} xuống cuối`} className="h-2 rounded border border-dashed border-transparent" onDragOver={(event) => { if (dragged?.kind === 'item' && dragged.nodeId === node.id) { event.preventDefault(); event.stopPropagation(); setDropTarget({ kind: 'item', nodeId: node.id, beforeItemId: null }) } }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); if (dragged?.kind === 'item' && dragged.nodeId === node.id) onMoveItem(node.id, dragged.itemId, null); resetDrag() }} />
              {dropTarget?.kind === 'item' && dropTarget.nodeId === node.id && dropTarget.beforeItemId === null && placeholder(`item:${node.id}:end`, label)}
            </div>}
          </div>
        )
      })}
      <div aria-label="Thả để chuyển node xuống cuối" className="h-2 rounded border border-dashed border-transparent" onDragOver={(event) => { if (dragged?.kind === 'node') { event.preventDefault(); setDropTarget({ kind: 'node', beforeNodeId: null }) } }} onDrop={(event) => { event.preventDefault(); if (dragged?.kind === 'node') onMoveNode(dragged.nodeId, null); resetDrag() }} />
      {dropTarget?.kind === 'node' && dropTarget.beforeNodeId === null && placeholder('node:end', 'cuối danh sách')}
    </div>
  )
}
