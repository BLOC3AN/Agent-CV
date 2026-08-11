import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { CVBlockRenderer } from '../src/components/CVBlockRenderer'
import { materializeItemOrder, moveItem, moveNode, normalizeLayout, resetDefaultLayout, setNodeVisible, synchronizeCVActiveSections } from '../src/lib/layout-draft'
import { initialCVs } from '../src/mockData'
import type { CVLayout } from '../src/types'
import { CV_FIELD_CATALOG } from '@hr/schema'

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
    { id: 'activities', type: 'activities', visible: true },
    { id: 'certifications', type: 'certifications', visible: true },
    { id: 'languages', type: 'languages', visible: true },
    { id: 'footer', type: 'footer', visible: true },
  ],
}

describe('layout draft operations', () => {
  it('moves a top-level node before another node without mutating the original layout', () => {
    const moved = moveNode(layout, 'skills', 'experience')

    expect(moved.nodes.map((node) => node.id)).toEqual([
      'header', 'summary', 'skills', 'experience', 'projects', 'education', 'activities', 'certifications', 'languages', 'footer',
    ])
    expect(layout.nodes.map((node) => node.id)).toEqual([
      'header', 'summary', 'experience', 'projects', 'education', 'skills', 'activities', 'certifications', 'languages', 'footer',
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
      'header', 'summary', 'experience', 'projects', 'education', 'skills', 'activities', 'certifications', 'languages', 'footer',
    ])
    expect(reset.nodes.every((node) => node.visible)).toBe(true)
  })

  it('normalizes legacy visibility into the canonical layout and lets layout visibility recover it', () => {
    const legacy = { ...cv, activeSections: { ...cv.activeSections, experience: false } }
    const normalized = normalizeLayout({ version: 1, nodes: layout.nodes.filter((node) => node.type !== 'activities') }, legacy.activeSections)

    expect(normalized.nodes).toHaveLength(10)
    expect(normalized.nodes.find((node) => node.type === 'experience')?.visible).toBe(false)
    expect(normalized.nodes.find((node) => node.type === 'activities')).toMatchObject({ id: 'activities', visible: true })

    const visible = setNodeVisible(normalized, 'experience', true)
    expect(synchronizeCVActiveSections(legacy, visible).activeSections.experience).toBe(true)
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
  it.each(['editor', 'preview', 'print'] as const)('renders Intro as the section title in %s', (variant) => {
    const { container } = render(<CVBlockRenderer cv={cv} layout={layout} variant={variant} />)
    const summaryNode = container.querySelector('[data-cv-node="summary"]')
    const heading = summaryNode?.querySelector('h3')

    expect(heading).toHaveTextContent('GIỚI THIỆU BẢN THÂN')
    expect(heading).toHaveAttribute('data-cv-typography', 'section-title')
  })

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

  it('renders only the nested items assigned to a composed page segment', () => {
    const { container } = render(
      <CVBlockRenderer
        cv={cv}
        layout={layout}
        variant="editor"
        nodeIds={['experience']}
        itemIds={{ experience: ['exp-1'] }}
      />,
    )

    const experience = container.querySelector('[data-cv-node="experience"]')
    expect(experience).toHaveTextContent('IMESPRO')
    expect(experience).not.toHaveTextContent('bTaskee')
  })

  it.each(['editor', 'preview', 'print'] as const)('renders activities and canonical registered fields in %s', (variant) => {
    const richCV = structuredClone(cv)
    richCV.sections.intro.careerObjective = 'Build dependable products'
    richCV.sections.intro.availability = 'Available in two weeks'
    Object.assign(richCV.sections.experience[0]!, { teamSize: '8 people', techStack: ['Go', 'React'] })
    Object.assign(richCV.sections.projects[0]!, { teamSize: '4 people', techStack: ['TypeScript'], contribution: 'Led the launch' })
    richCV.sections.education[0]!.gpa = '3.9'
    richCV.sections.education[0]!.highlights = ['Dean list']
    richCV.sections.activities = [{ id: 'activity-1', organization: 'Open Source Club', role: 'Mentor', startDate: '2024', endDate: '2025', highlights: ['Coached contributors'] }]
    richCV.sections.certifications[0] = { ...richCV.sections.certifications[0]!, date: '2025', link: 'https://cert.example' }
    const canonical = normalizeLayout(undefined)

    const { container } = render(<CVBlockRenderer cv={richCV} layout={canonical} variant={variant} />)
    const content = container.textContent ?? ''
    for (const expected of [
      'Build dependable products', 'Available in two weeks', '8 people', 'Go', 'React',
      '4 people', 'TypeScript', 'Led the launch', '3.9', 'Dean list', 'Open Source Club',
      'Mentor', 'Coached contributors', '2025', 'https://cert.example',
    ]) expect(content).toContain(expected)
    expect(container.querySelector('[data-cv-node="activities"]')).not.toBeNull()
    for (const field of CV_FIELD_CATALOG) {
      const optionalEmptyFields = ['avatarUrl', 'website', 'link', 'careerObjective', 'availability', 'location', 'gpa', 'contribution', 'teamSize', 'techStack']
      if (optionalEmptyFields.includes(field.key)) continue
      expect(container.querySelector(`[data-cv-field="${field.key}"]`), `missing registered field ${field.key}`).not.toBeNull()
    }
    expect(container.querySelector('[data-cv-field="techStack"]')).toHaveAttribute('data-print-style', 'tags')
  })
})
