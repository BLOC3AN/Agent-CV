import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { heightsForItem, measureNodeChrome, pageGroupsForNodes, pageSlices, parseSegment, segmentsForLayout } from '../src/components/CVPageComposer'
import { CVBlockRenderer } from '../src/components/CVBlockRenderer'
import { initialCVs } from './fixtures/cvs'
import type { CVLayout } from '../src/types'

const cv = initialCVs[0]!
const layout: CVLayout = {
  version: 1,
  nodes: [
    { id: 'summary', type: 'summary', visible: true },
    { id: 'experience', type: 'experience', visible: true, itemOrder: ['exp-2', 'exp-1'] },
  ],
}

function stubHeight(element: Element, height: number) {
  element.getBoundingClientRect = () => ({ height }) as DOMRect
}

function stubBox(element: Element, top: number, height: number) {
  element.getBoundingClientRect = () => ({ top, height, bottom: top + height }) as DOMRect
}

function nodeElement(nodeId: string): HTMLElement {
  const element = document.createElement('div')
  element.dataset.cvNodeId = nodeId
  return element
}

describe('page segments', () => {
  it('emits one head segment plus one segment per bullet for splittable items', () => {
    expect(segmentsForLayout(cv, layout)).toEqual([
      'summary',
      'experience::exp-2::head', 'experience::exp-2::h0', 'experience::exp-2::h1',
      'experience::exp-1::head', 'experience::exp-1::h0', 'experience::exp-1::h1', 'experience::exp-1::h2', 'experience::exp-1::h3',
    ])
  })

  it('parses all three segment shapes', () => {
    expect(parseSegment('summary')).toEqual({ nodeId: 'summary' })
    expect(parseSegment('experience::exp-1::head')).toEqual({ nodeId: 'experience', itemId: 'exp-1', part: 'head' })
    expect(parseSegment('experience::exp-1::h12')).toEqual({ nodeId: 'experience', itemId: 'exp-1', part: 12 })
  })

  it('measures the item head as the item minus its bullet list', () => {
    const item = document.createElement('div')
    const list = document.createElement('ul')
    list.className = 'cv-bullets'
    const first = document.createElement('li')
    const second = document.createElement('li')
    list.append(first, second)
    item.append(list)
    stubHeight(item, 300)
    stubHeight(list, 180)
    stubHeight(first, 80)
    stubHeight(second, 100)

    expect(heightsForItem(item)).toEqual({ head: 120, highlights: [80, 100] })
  })

  it('measures an item without bullets as head only', () => {
    const item = document.createElement('div')
    stubHeight(item, 90)

    expect(heightsForItem(item)).toEqual({ head: 90, highlights: [] })
  })

  it('groups the sub-segments of a page into node ids, item ids and slices', () => {
    expect(pageSlices(['experience::exp-1::h2', 'experience::exp-1::h3', 'education::edu-1::head'])).toEqual({
      nodeIds: ['experience', 'education'],
      itemIds: { experience: ['exp-1'], education: ['edu-1'] },
      itemSlices: { 'exp-1': { head: false, highlights: [2, 3] }, 'edu-1': { head: true, highlights: [] } },
    })
  })

  it('keeps the leading bullets with the item head and flows the rest to the next page', () => {
    const segments = ['experience::exp-1::head', ...Array.from({ length: 5 }, (_, index) => `experience::exp-1::h${index}`)]
    const heights = new Map(segments.map((segment) => [segment, 100]))

    expect(pageGroupsForNodes(segments, heights, 400)).toEqual([
      ['experience::exp-1::head', 'experience::exp-1::h0', 'experience::exp-1::h1', 'experience::exp-1::h2'],
      ['experience::exp-1::h3', 'experience::exp-1::h4'],
    ])
  })
})

describe('heightsForItem against real CVBlockRenderer markup', () => {
  // `heightsForItem`/`bulletListOf` giả định `ul.cv-bullets` là CON TRỰC TIẾP
  // của `[data-cv-item-id]`. CVPageComposer chỉ ghép hàm này với DOM do
  // CVBlockRenderer render ra (không phải cây tự dựng), nên hợp đồng đó phải
  // được ghim vào đúng markup thật — nếu CVBlockRenderer đổi cấu trúc lồng,
  // test này phải đỏ trước khi tách trang theo bullet lặng lẽ tắt ngóm.
  it('measures head and highlight heights off the item CVBlockRenderer actually renders', () => {
    const { container } = render(
      <CVBlockRenderer
        cv={cv}
        layout={{ version: 1, nodes: [{ id: 'experience', type: 'experience', visible: true }] }}
        variant="preview"
        nodeIds={['experience']}
        itemIds={{ experience: ['exp-1'] }}
      />,
    )
    const item = container.querySelector('[data-cv-item-id="exp-1"]')!
    const list = item.querySelector('ul.cv-bullets')!
    const bullets = [...list.querySelectorAll('li')]
    expect(bullets).toHaveLength(4)

    stubHeight(item, 300)
    stubHeight(list, 180)
    const bulletHeights = bullets.map((bullet, index) => 40 + index * 10)
    bullets.forEach((bullet, index) => stubHeight(bullet, bulletHeights[index]!))

    expect(heightsForItem(item)).toEqual({ head: 120, highlights: bulletHeights })
  })
})

describe('section chrome', () => {
  // Tổng chiều cao các đoạn con của một node KHÔNG bằng chiều cao node: còn tiêu
  // đề mục, các khe `space-y-*` giữa entry và lề `mb-6` giữa các mục. Bỏ qua
  // phần khung này thì bộ xếp trang tưởng CV ngắn hơn thực tế và nhồi thừa.
  it('measures the chrome of a node as the node minus its own segments', () => {
    const root = document.createElement('div')
    const summary = nodeElement('summary')
    const experience = nodeElement('experience')
    root.append(summary, experience)
    stubBox(summary, 0, 117)
    stubBox(experience, 141, 544)
    const heights = new Map([
      ['summary', 117],
      ['experience::exp-1::head', 200],
      ['experience::exp-1::h0', 140],
      ['experience::exp-2::head', 100],
      ['experience::exp-2::h0', 43],
    ])

    const chrome = measureNodeChrome(root, ['summary', 'experience'], [...heights.keys()], heights)

    // summary: một đoạn duy nhất bằng cả node → không có khung thừa.
    expect(chrome.get('summary')).toEqual({ repeated: 0, gapBefore: 0 })
    // experience: 544 − (200+140+100+43) = 61 khung, và khe 141−117 = 24 với node trước.
    expect(chrome.get('experience')).toEqual({ repeated: 61, gapBefore: 24 })
  })

  it('reports no chrome for a node that renders nothing, and keeps the gap measured off the last node that did', () => {
    const root = document.createElement('div')
    const header = nodeElement('header')
    const experience = nodeElement('experience')
    root.append(header, experience)
    stubBox(header, 0, 99)
    stubBox(experience, 123, 300)
    const heights = new Map([['header', 99], ['experience::exp-1::head', 300]])

    const chrome = measureNodeChrome(root, ['header', 'summary', 'experience'], [...heights.keys()], heights)

    expect(chrome.get('summary')).toEqual({ repeated: 0, gapBefore: 0 })
    expect(chrome.get('experience')).toEqual({ repeated: 0, gapBefore: 24 })
  })

  it('charges the chrome of a node on every page that node spans', () => {
    const segments = ['experience::exp-1::head', ...Array.from({ length: 5 }, (_, index) => `experience::exp-1::h${index}`)]
    const heights = new Map(segments.map((segment) => [segment, 100]))
    const chrome = new Map([['experience', { repeated: 50, gapBefore: 0 }]])

    expect(pageGroupsForNodes(segments, heights, 300, chrome)).toEqual([
      ['experience::exp-1::head', 'experience::exp-1::h0'],
      ['experience::exp-1::h1', 'experience::exp-1::h2'],
      ['experience::exp-1::h3', 'experience::exp-1::h4'],
    ])
  })

  it('charges the gap before a node only when the node does not open the page', () => {
    const segments = ['summary', 'experience::exp-1::head', 'experience::exp-1::h0']
    const heights = new Map([['summary', 100], ['experience::exp-1::head', 100], ['experience::exp-1::h0', 100]])
    const chrome = new Map([
      ['summary', { repeated: 0, gapBefore: 0 }],
      ['experience', { repeated: 0, gapBefore: 60 }],
    ])

    // 100 + 60 + 100 = 260 > 250 → experience mở trang mới; ở đầu trang khe 60
    // biến mất nên cả hai đoạn của nó cùng nằm vừa trang thứ hai.
    expect(pageGroupsForNodes(segments, heights, 250, chrome)).toEqual([
      ['summary'],
      ['experience::exp-1::head', 'experience::exp-1::h0'],
    ])
    // Không có khe thì cả ba đoạn vừa một trang 300px.
    expect(pageGroupsForNodes(segments, heights, 300)).toEqual([segments])
  })
})

describe('section chrome against real CVBlockRenderer markup', () => {
  // `measureNodeChrome` lấy khung bằng hiệu (node − các đoạn con). Phép trừ đó
  // chỉ bắt được tiêu đề mục nếu `<h3>` nằm TRONG node frame và NGOÀI mọi item;
  // nếu tiêu đề chui vào item thì nó bị tính vào `head` của item và khung tụt về 0.
  it('keeps the section heading inside the node frame but outside every item', () => {
    const { container } = render(
      <CVBlockRenderer
        cv={cv}
        layout={{ version: 1, nodes: [{ id: 'experience', type: 'experience', visible: true }] }}
        variant="preview"
        nodeIds={['experience']}
      />,
    )
    const node = container.querySelector('[data-cv-node-id="experience"]')!
    const heading = node.querySelector('[data-cv-typography="section-title"]')!
    expect(heading.tagName).toBe('H3')
    expect(heading.closest('[data-cv-item-id]')).toBeNull()
    expect(node.querySelectorAll('[data-cv-item-id]').length).toBeGreaterThan(0)
  })
})

describe('CVPageComposer', () => {
  it('paginates the item head and its bullets as separate units', () => {
    const segments = segmentsForLayout(cv, layout)
    const heights = new Map(segments.map((segment) => [segment, 100]))
    const pages = pageGroupsForNodes(segments, heights, 300)

    const first = pageSlices(pages[0]!)
    expect(first.itemSlices['exp-2']).toEqual({ head: true, highlights: [0] })

    const carried = pages.flatMap((page) => pageSlices(page).itemSlices['exp-2']?.highlights ?? [])
    expect(carried).toEqual([0, 1])
  })
})
