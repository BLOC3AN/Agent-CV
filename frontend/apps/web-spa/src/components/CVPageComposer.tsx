import React, { useLayoutEffect, useRef, useState } from 'react'
import type { CV, CVLayout } from '../types'
import { A4_PAGE_SETTINGS } from '../lib/a4-settings'
import { pageContentHeightPx } from '../lib/cv-typography'
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

/**
 * Phần chiều cao của một mục KHÔNG nằm trong bất kỳ đoạn con nào của nó.
 *
 * `repeated`: tiêu đề mục (`<h3>`) cộng các khe `space-y-*` giữa những entry
 * bên trong mục. Tiêu đề được render LẠI trên mọi trang mà mục kéo qua, nên
 * phần này bị tính cho từng trang chứ không phải một lần.
 * `gapBefore`: khe đứng (`mb-6`, đã gộp lề) ngăn mục này với mục liền trước
 * trong dòng chảy. Khe đó biến mất nếu mục mở đầu một trang.
 *
 * Cả hai đều ĐO từ DOM thật (`measureNodeChrome`), không phải hằng số ghim:
 * chúng đi theo typography và class Tailwind của chính CV đó.
 */
export interface NodeChrome {
  repeated: number
  gapBefore: number
}

/**
 * Hàm THUẦN: chỉ ăn (segments, heights, capacity, chrome) nên unit test bơm
 * chiều cao giả là kiểm được, không cần trình duyệt thật.
 */
function pageGroupsForNodes(segments: string[], heights: Map<string, number>, capacity: number, chrome?: Map<string, NodeChrome>): string[][] {
  const pages: string[][] = []
  let page: string[] = []
  let opened = new Set<string>()
  let used = 0
  // Chi phí "mở" một mục trên trang hiện tại: khung của mục (nếu trang chưa có
  // đoạn nào của mục) cộng khe với mục trước (nếu mục không mở đầu trang).
  const openingCost = (nodeId: string) => {
    if (opened.has(nodeId)) return 0
    const frame = chrome?.get(nodeId)
    return (frame?.repeated ?? 0) + (page.length ? (frame?.gapBefore ?? 0) : 0)
  }
  for (const segment of segments) {
    const { nodeId } = parseSegment(segment)
    const height = heights.get(segment) ?? 0
    if (page.length && used + openingCost(nodeId) + height > capacity) {
      pages.push(page)
      page = []
      opened = new Set()
      used = 0
    }
    used += openingCost(nodeId) + height
    opened.add(nodeId)
    page.push(segment)
  }
  if (page.length) pages.push(page)
  return pages
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
  // Khoá theo `type:id` chứ không riêng id, để đếm bullet của item đúng mục kể
  // cả khi hai section trùng id item. Lưu ý phòng tuyến này DỪNG ở khâu đếm/đo:
  // `pageSlices` vẫn khoá `itemSlices` bằng id trần và CVBlockRenderer cũng tra
  // theo `item.id` trần (hợp đồng của Task 2), nên nếu id thật sự đụng nhau
  // giữa hai mục thì lát cắt của chúng vẫn lẫn vào nhau.
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

function boxOf(element?: Element): { top: number; bottom: number; height: number } {
  if (!element) return { top: 0, bottom: 0, height: 0 }
  const rect = element.getBoundingClientRect()
  // Cùng đường lùi như `heightOf`: rect rỗng thì hỏi `offsetHeight`.
  const height = rect.height || (element as HTMLElement).offsetHeight || 0
  const top = rect.top ?? 0
  return { top, bottom: top + height, height }
}

/**
 * Đo phần khung của từng mục trên bản dựng để đo (`measurementRef`).
 *
 * Khung = chiều cao node − tổng chiều cao các đoạn con của chính nó. Hiệu này
 * ôm trọn tiêu đề mục, các khe `space-y-*` giữa entry và cả lề dưới của từng
 * `<li>` — những thứ `getBoundingClientRect` không kể vào các đoạn con. Khe
 * giữa hai mục lấy bằng `top` của mục sau trừ `bottom` của mục trước, nên lề
 * đã gộp (`margin collapsing`) cũng được tính đúng như trình duyệt dựng ra.
 *
 * Mục không render gì (ví dụ `summary` rỗng) không có phần tử → khung 0 và
 * không làm mốc cho khe của mục kế tiếp.
 */
function measureNodeChrome(root: Element | null | undefined, nodeIds: string[], segments: string[], heights: Map<string, number>): Map<string, NodeChrome> {
  const chrome = new Map<string, NodeChrome>()
  if (!root) return chrome
  const covered = new Map<string, number>()
  for (const segment of segments) {
    const { nodeId } = parseSegment(segment)
    covered.set(nodeId, (covered.get(nodeId) ?? 0) + (heights.get(segment) ?? 0))
  }
  const elements = [...root.querySelectorAll<HTMLElement>('[data-cv-node-id]')]
  let previousBottom: number | null = null
  for (const nodeId of nodeIds) {
    const element = elements.find((candidate) => candidate.dataset.cvNodeId === nodeId)
    if (!element) {
      chrome.set(nodeId, { repeated: 0, gapBefore: 0 })
      continue
    }
    const box = boxOf(element)
    chrome.set(nodeId, {
      // `max(0, …)` chặn nhiễu đo: phần tử định vị tuyệt đối trong node (vạch
      // màu của header) có thể đẩy tổng đoạn con vượt chiều cao node.
      repeated: Math.max(0, box.height - (covered.get(nodeId) ?? 0)),
      gapBefore: previousBottom === null ? 0 : Math.max(0, box.top - previousBottom),
    })
    previousBottom = box.bottom
  }
  return chrome
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
  // Sức chứa một trang preview = đúng hộp nội dung mà PDF dùng (xem
  // `pageContentHeightPx`); `test/print.test.ts` ghim hai nửa không được lệch.
  const contentHeightPx = pageContentHeightPx(cv.design)

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
    setPageGroups(pageGroupsForNodes(segments, heights, contentHeightPx, measureNodeChrome(measurement, visibleNodeIds, segments, heights)))
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

export { heightsForItem, measureNodeChrome, pageGroupsForNodes, pageSlices, parseSegment, segmentsForLayout }
