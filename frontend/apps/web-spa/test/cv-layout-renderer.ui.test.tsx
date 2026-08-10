import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { CVBlockRenderer } from '../src/components/CVBlockRenderer'
import { materializeItemOrder, moveItem, moveNode, resetDefaultLayout, setNodeVisible } from '../src/lib/layout-draft'
import { initialCVs } from '../src/mockData'
import type { CVLayout } from '../src/types'

const cv = initialCVs[0]!

const layout: CVLayout = {
  version: 1,
  nodes: [
    { id: 'header', type: 'header', visible: true },
    { id: 'summary', type: 'summary', visible: true },
    { id: 'experience', type: 'experience', visible: true, itemOrder: ['exp-2', 'exp-1'] },
    { id: 'projects', type: 'projects', visible: true },
    { id: 'education', type: 'education', visible: true },
    { id: 'skills', type: 'skills', visible: true },
    { id: 'certifications', type: 'certifications', visible: true },
    { id: 'languages', type: 'languages', visible: true },
    { id: 'footer', type: 'footer', visible: true },
  ],
}

describe('layout draft operations', () => {
  it('moves a top-level node before another node without mutating the original layout', () => {
    const moved = moveNode(layout, 'skills', 'experience')

    expect(moved.nodes.map((node) => node.id)).toEqual([
      'header', 'summary', 'skills', 'experience', 'projects', 'education', 'certifications', 'languages', 'footer',
    ])
    expect(layout.nodes.map((node) => node.id)).toEqual([
      'header', 'summary', 'experience', 'projects', 'education', 'skills', 'certifications', 'languages', 'footer',
    ])
  })

  it('moves an item within its owning node and retains unlisted CV items', () => {
    const moved = moveItem(layout, 'experience', 'exp-1', 'exp-2')

    expect(moved.nodes.find((node) => node.id === 'experience')?.itemOrder).toEqual(['exp-1', 'exp-2'])
    expect(layout.nodes.find((node) => node.id === 'experience')?.itemOrder).toEqual(['exp-2', 'exp-1'])
  })

  it('materializes and moves nested items from a legacy/default node without itemOrder', () => {
    const legacyLayout: CVLayout = {
      version: 1,
      nodes: [{ id: 'experience', type: 'experience', visible: true }],
    }

    const materialized = materializeItemOrder(legacyLayout, 'experience', ['exp-1', 'exp-2'])
    const moved = moveItem(materialized, 'experience', 'exp-2', 'exp-1')

    expect(moved).not.toBe(legacyLayout)
    expect(moved.nodes[0]).toMatchObject({ id: 'experience', itemOrder: ['exp-2', 'exp-1'] })
    expect(legacyLayout.nodes[0]).not.toHaveProperty('itemOrder')
  })

  it('hides and unhides a node without deleting the underlying CV content', () => {
    const hidden = setNodeVisible(layout, 'experience', false)
    const visible = setNodeVisible(hidden, 'experience', true)

    expect(hidden.nodes.find((node) => node.id === 'experience')?.visible).toBe(false)
    expect(visible.nodes.find((node) => node.id === 'experience')?.visible).toBe(true)
    expect(cv.sections.experience).toHaveLength(2)
  })

  it('resets every layout to the stable default order', () => {
    const reset = resetDefaultLayout(moveNode(layout, 'footer', 'header'))

    expect(reset.nodes.map((node) => node.id)).toEqual([
      'header', 'summary', 'experience', 'projects', 'education', 'skills', 'certifications', 'languages', 'footer',
    ])
    expect(reset.nodes.every((node) => node.visible)).toBe(true)
  })

  it('leaves unknown or incompatible identifiers unchanged', () => {
    expect(moveNode(layout, 'unknown', null)).toBe(layout)
    expect(moveNode(layout, 'header', 'unknown')).toBe(layout)
    expect(moveItem(layout, 'skills', 'exp-1', null)).toBe(layout)
    expect(moveItem(layout, 'experience', 'unknown', null)).toBe(layout)
    expect(moveItem(layout, 'experience', 'exp-1', 'unknown')).toBe(layout)
    expect(setNodeVisible(layout, 'unknown', false)).toBe(layout)
  })
})

describe('CVBlockRenderer', () => {
  it('renders visible Header and Footer in their layout positions and resolves nested item order', () => {
    const reordered: CVLayout = {
      version: 1,
      nodes: [
        { id: 'experience', type: 'experience', visible: true, itemOrder: ['exp-2', 'exp-1'] },
        { id: 'header', type: 'header', visible: true },
        { id: 'footer', type: 'footer', visible: true },
        { id: 'skills', type: 'skills', visible: true },
      ],
    }
    const { container } = render(<CVBlockRenderer cv={cv} layout={reordered} variant="editor" />)

    expect([...container.querySelectorAll('[data-cv-node]')].map((node) => node.getAttribute('data-cv-node'))).toEqual([
      'experience', 'header', 'footer', 'skills',
    ])
    expect(container.querySelector('[data-cv-node="experience"]')?.textContent).toMatch(/bTaskee[\s\S]*IMESPRO/)
  })
})
