import React, { useLayoutEffect, useRef, useState } from 'react'
import type { CV, CVLayout } from '../types'
import { A4_PAGE_SETTINGS } from '../lib/a4-settings'
import { CVBlockRenderer, type CVRenderVariant } from './CVBlockRenderer'
import { PaginatedA4Document } from './PaginatedA4Document'

const SEGMENT_SEPARATOR = '::'
const SPLITTABLE_NODES = new Set(['experience', 'projects', 'education'])

function orderedItemIds(items: { id: string }[], itemOrder?: string[]): string[] {
  if (!itemOrder?.length) return items.map((item) => item.id)
  const existing = new Set(items.map((item) => item.id))
  const ordered = itemOrder.filter((id) => existing.has(id))
  const listed = new Set(ordered)
  return [...ordered, ...items.map((item) => item.id).filter((id) => !listed.has(id))]
}

interface CVPageComposerProps {
  cv: CV
  layout: CVLayout
  variant: Exclude<CVRenderVariant, 'print'>
  style?: React.CSSProperties
  className?: string
  id?: string
  selectedNodeId?: string
  selectedItemId?: string
  onSelect?: (nodeId: string, itemId?: string) => void
  onEdit?: (nodeId: string, itemId?: string) => void
  /** Ngôn ngữ hiển thị tiêu đề mục; vắng mặt thì theo `cv.language`. */
  language?: string
}

function pageGroupsForNodes(nodeIds: string[], heights: Map<string, number>, capacity: number): string[][] {
  const pages: string[][] = [[]]
  let used = 0
  for (const nodeId of nodeIds) {
    const height = heights.get(nodeId) ?? 0
    if (pages[pages.length - 1]!.length && used + height > capacity) {
      pages.push([])
      used = 0
    }
    pages[pages.length - 1]!.push(nodeId)
    used += height
  }
  return pages.filter((page) => page.length > 0)
}

function segmentNodeId(segment: string): string {
  return segment.split(SEGMENT_SEPARATOR, 1)[0]!
}

function segmentItemId(segment: string): string | undefined {
  const separator = segment.indexOf(SEGMENT_SEPARATOR)
  return separator === -1 ? undefined : segment.slice(separator + SEGMENT_SEPARATOR.length)
}

export function CVPageComposer({ cv, layout, variant, style, className = '', id, selectedNodeId, selectedItemId, onSelect, onEdit, language }: CVPageComposerProps) {
  const visibleNodeIds = layout.nodes.filter((node) => node.visible).map((node) => node.id)
  const itemIdsByNode = new Map<string, string[]>([
    ['experience', orderedItemIds(cv.sections.experience, layout.nodes.find((node) => node.type === 'experience' && 'itemOrder' in node)?.itemOrder)],
    ['projects', orderedItemIds(cv.sections.projects, layout.nodes.find((node) => node.type === 'projects' && 'itemOrder' in node)?.itemOrder)],
    ['education', orderedItemIds(cv.sections.education, layout.nodes.find((node) => node.type === 'education' && 'itemOrder' in node)?.itemOrder)],
  ])
  const segments = layout.nodes.filter((node) => node.visible).flatMap((node) => {
    if (!SPLITTABLE_NODES.has(node.type)) return [node.id]
    const itemIds = itemIdsByNode.get(node.type) ?? []
    return itemIds.map((itemId) => `${node.id}${SEGMENT_SEPARATOR}${itemId}`)
  })
  const measurementKey = `${variant}:${language ?? ''}:${JSON.stringify(cv)}:${JSON.stringify(layout)}`
  const measurementRef = useRef<HTMLDivElement>(null)
  const [pageGroups, setPageGroups] = useState<string[][]>(() => [visibleNodeIds])
  const [measuredKey, setMeasuredKey] = useState<string | null>(null)
  const contentHeightPx = (297 - (cv.design.paddingTop ?? 20) - (cv.design.paddingBottom ?? 20)) * 96 / 25.4

  useLayoutEffect(() => {
    const measurement = measurementRef.current
    if (!measurement) return
    if (!visibleNodeIds.length) {
      setPageGroups([[]])
      setMeasuredKey(measurementKey)
      return
    }
    const heights = new Map<string, number>()
    for (const segment of segments) {
      const nodeId = segmentNodeId(segment)
      const itemId = segmentItemId(segment)
      const selector = itemId ? '[data-cv-item-id]' : '[data-cv-node-id]'
      const element = [...measurement.querySelectorAll<HTMLElement>('[data-cv-node-id]')]
        .find((candidate) => candidate.dataset.cvNodeId === nodeId)
      const item = itemId ? [...(element?.querySelectorAll<HTMLElement>(selector) ?? [])]
        .find((candidate) => candidate.dataset.cvItemId === itemId) : undefined
      const heightTarget = item ?? element
      heights.set(segment, heightTarget?.getBoundingClientRect().height || heightTarget?.offsetHeight || 0)
    }
    setPageGroups(pageGroupsForNodes(segments, heights, contentHeightPx))
    setMeasuredKey(measurementKey)
  }, [cv, layout, variant, visibleNodeIds.join('|'), segments.join('|'), measurementKey, contentHeightPx])

  return (
    <>
      {measuredKey !== measurementKey && <div
        ref={measurementRef}
        aria-hidden="true"
        className="pointer-events-none absolute -left-[100000px] top-0 w-[210mm] box-border opacity-0"
        style={{ ...style, paddingTop: 'var(--cv-padding-top)', paddingBottom: 'var(--cv-padding-bottom)', paddingLeft: 'var(--cv-padding-left)', paddingRight: 'var(--cv-padding-right)', lineHeight: 'var(--cv-line-height)' }}
      >
        <CVBlockRenderer cv={cv} layout={layout} variant={variant} nodeIds={visibleNodeIds} language={language} />
      </div>}
      <PaginatedA4Document
        id={id}
        className={`cv-page-composer ${className}`}
        pageGroups={pageGroups}
        renderPage={(pageSegments) => {
          const nodeIds = [...new Set(pageSegments.map(segmentNodeId))]
          const itemIds = pageSegments.reduce<Record<string, string[]>>((result, segment) => {
            const itemId = segmentItemId(segment)
            if (!itemId) return result
            const nodeId = segmentNodeId(segment)
            result[nodeId] = [...(result[nodeId] ?? []), itemId]
            return result
          }, {})
          return (
          <div className="cv-page-flow" style={{ lineHeight: 'var(--cv-line-height)' }}>
            <CVBlockRenderer cv={cv} layout={layout} variant={variant} nodeIds={nodeIds} itemIds={itemIds} selectedNodeId={selectedNodeId} selectedItemId={selectedItemId} onSelect={onSelect} onEdit={onEdit} language={language} />
          </div>
          )
        }}
        style={style}
      />
    </>
  )
}

export { pageGroupsForNodes }
