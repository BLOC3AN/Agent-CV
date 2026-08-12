import React, { useLayoutEffect, useRef, useState } from 'react'
import type { CV, CVLayout } from '../types'
import { A4_PAGE_SETTINGS } from '../lib/a4-settings'
import { CVBlockRenderer, type CVItemSlice, type CVRenderVariant } from './CVBlockRenderer'
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

const SPLITTABLE_SECTIONS = ['experience', 'projects', 'education'] as const

interface ParsedSegment {
  nodeId: string
  itemId?: string
  /** 'head' = phần đầu item; số = index GỐC của một gạch đầu dòng. */
  part?: 'head' | number
}

function parseSegment(segment: string): ParsedSegment {
  const [nodeId, itemId, part] = segment.split(SEGMENT_SEPARATOR)
  if (!itemId) return { nodeId: nodeId! }
  if (part === 'head') return { nodeId: nodeId!, itemId, part: 'head' }
  return { nodeId: nodeId!, itemId, part: Number(part!.slice(1)) }
}

function segmentsForLayout(cv: CV, layout: CVLayout): string[] {
  // Khoá theo `type:id` chứ không riêng id: hai section khác nhau về lý thuyết
  // có thể mang trùng id item, và nhầm ở đây thì số bullet sẽ sai câm.
  const highlightCounts = new Map<string, number>()
  for (const type of SPLITTABLE_SECTIONS) {
    for (const item of cv.sections[type]) highlightCounts.set(`${type}:${item.id}`, item.highlights?.length ?? 0)
  }
  const itemIdsByNode = new Map<string, string[]>(SPLITTABLE_SECTIONS.map((type) => [
    type,
    orderedItemIds(cv.sections[type], layout.nodes.find((node) => node.type === type && 'itemOrder' in node)?.itemOrder),
  ]))
  return layout.nodes.filter((node) => node.visible).flatMap((node) => {
    if (!SPLITTABLE_NODES.has(node.type)) return [node.id]
    const itemIds = itemIdsByNode.get(node.type) ?? []
    return itemIds.flatMap((itemId) => {
      const base = `${node.id}${SEGMENT_SEPARATOR}${itemId}`
      const count = highlightCounts.get(`${node.type}:${itemId}`) ?? 0
      return [`${base}${SEGMENT_SEPARATOR}head`, ...Array.from({ length: count }, (_, index) => `${base}${SEGMENT_SEPARATOR}h${index}`)]
    })
  })
}

function heightOf(element?: Element): number {
  if (!element) return 0
  return element.getBoundingClientRect().height || (element as HTMLElement).offsetHeight || 0
}

function bulletListOf(item?: Element): Element | undefined {
  // Duyệt con trực tiếp thay vì `:scope > ul.cv-bullets` — bám vào cấu trúc thật
  // của `.cv-entry` và không phụ thuộc mức hỗ trợ selector của môi trường test.
  return item ? [...item.children].find((child) => child.classList.contains('cv-bullets')) : undefined
}

function heightsForItem(item?: Element): { head: number; highlights: number[] } {
  const list = bulletListOf(item)
  return {
    head: heightOf(item) - heightOf(list),
    highlights: list ? [...list.children].map((bullet) => heightOf(bullet)) : [],
  }
}

function pageSlices(pageSegments: string[]): { nodeIds: string[]; itemIds: Record<string, string[]>; itemSlices: Record<string, CVItemSlice> } {
  const nodeIds: string[] = []
  const itemIds: Record<string, string[]> = {}
  const itemSlices: Record<string, CVItemSlice> = {}
  for (const segment of pageSegments) {
    const { nodeId, itemId, part } = parseSegment(segment)
    if (!nodeIds.includes(nodeId)) nodeIds.push(nodeId)
    if (!itemId) continue
    if (!itemIds[nodeId]) itemIds[nodeId] = []
    if (!itemIds[nodeId]!.includes(itemId)) itemIds[nodeId]!.push(itemId)
    if (!itemSlices[itemId]) itemSlices[itemId] = { head: false, highlights: [] }
    if (part === 'head') itemSlices[itemId]!.head = true
    else if (typeof part === 'number') itemSlices[itemId]!.highlights.push(part)
  }
  return { nodeIds, itemIds, itemSlices }
}

export function CVPageComposer({ cv, layout, variant, style, className = '', id, selectedNodeId, selectedItemId, onSelect, onEdit, language }: CVPageComposerProps) {
  const visibleNodeIds = layout.nodes.filter((node) => node.visible).map((node) => node.id)
  const segments = segmentsForLayout(cv, layout)
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
    const itemHeights = new Map<string, { head: number; highlights: number[] }>()
    for (const segment of segments) {
      const { nodeId, itemId, part } = parseSegment(segment)
      const element = [...measurement.querySelectorAll<HTMLElement>('[data-cv-node-id]')]
        .find((candidate) => candidate.dataset.cvNodeId === nodeId)
      if (!itemId) {
        heights.set(segment, heightOf(element))
        continue
      }
      const cacheKey = `${nodeId}${SEGMENT_SEPARATOR}${itemId}`
      if (!itemHeights.has(cacheKey)) {
        const item = element ? [...element.querySelectorAll<HTMLElement>('[data-cv-item-id]')]
          .find((candidate) => candidate.dataset.cvItemId === itemId) : undefined
        itemHeights.set(cacheKey, heightsForItem(item))
      }
      const measured = itemHeights.get(cacheKey)!
      heights.set(segment, part === 'head' ? measured.head : (measured.highlights[part as number] ?? 0))
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
          const { nodeIds, itemIds, itemSlices } = pageSlices(pageSegments)
          return (
          <div className="cv-page-flow" style={{ lineHeight: 'var(--cv-line-height)' }}>
            <CVBlockRenderer cv={cv} layout={layout} variant={variant} nodeIds={nodeIds} itemIds={itemIds} itemSlices={itemSlices} selectedNodeId={selectedNodeId} selectedItemId={selectedItemId} onSelect={onSelect} onEdit={onEdit} language={language} />
          </div>
          )
        }}
        style={style}
      />
    </>
  )
}

export { heightsForItem, pageGroupsForNodes, pageSlices, parseSegment, segmentsForLayout }
