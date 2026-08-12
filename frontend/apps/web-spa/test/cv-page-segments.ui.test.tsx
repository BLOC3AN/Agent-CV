import { describe, expect, it } from 'vitest'
import { heightsForItem, pageGroupsForNodes, pageSlices, parseSegment, segmentsForLayout } from '../src/components/CVPageComposer'
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
