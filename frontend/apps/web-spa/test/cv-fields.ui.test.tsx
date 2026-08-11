import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { CVEditorView } from '../src/components/CVEditorView'
import { initialCVs } from '../src/mockData'
import { getCVFieldDraftValue, updateCVFieldDraft } from '../src/lib/cv-store'
import type { CV, CVLayout } from '../src/types'

const layout: CVLayout = {
  version: 1,
  nodes: [
    { id: 'header', type: 'header', visible: true },
    { id: 'summary', type: 'summary', visible: true },
    { id: 'experience', type: 'experience', visible: true, itemOrder: ['exp-1', 'exp-2'] },
    { id: 'projects', type: 'projects', visible: true, itemOrder: ['proj-1', 'proj-2'] },
    { id: 'education', type: 'education', visible: true, itemOrder: ['edu-1'] },
  ],
}

function DraftEditor() {
  const [cv, setCV] = useState(() => structuredClone(initialCVs[0]!) as CV)
  const [draftLayout, setDraftLayout] = useState(layout)
  const [dirty, setDirty] = useState(false)

  return <CVEditorView
    cv={cv}
    layout={draftLayout}
    dirty={dirty}
    onUpdateCV={(next) => { setCV(next); setDirty(true) }}
    onUpdateLayout={(next) => { setDraftLayout(next); setDirty(true) }}
    onOpenPreview={() => undefined}
    onOpenShare={() => undefined}
    onDownloadPDF={() => undefined}
  />
}

function openExperienceItem() {
  fireEvent.doubleClick(screen.getByText('IMESPRO'))
  return screen.getByRole('dialog', { name: 'Chỉnh sửa Kinh nghiệm làm việc' })
}

function openProjectItem() {
  fireEvent.doubleClick(screen.getByText(/Vision MLOps Platform/))
  return screen.getByRole('dialog', { name: 'Chỉnh sửa Dự án nổi bật' })
}

describe('catalog-driven inline CV editing', () => {
  it('round-trips canonical fields without aliasing the headline or marker-like user bullets', () => {
    const source = structuredClone(initialCVs[0]!) as CV
    source.sections.experience[0]!.highlights = ['Team size: this is a genuine achievement']
    const header = { id: 'header', type: 'header', visible: true } as const
    const experience = { id: 'experience', type: 'experience', visible: true } as const

    const withAvailability = updateCVFieldDraft(source, header, undefined, 'availability', 'Two weeks')
    const updated = updateCVFieldDraft(withAvailability, experience, source.sections.experience[0]!.id, 'teamSize', '8 engineers')

    expect(withAvailability.sections.intro.title).toBe(source.sections.intro.title)
    expect(getCVFieldDraftValue(updated, header, undefined, 'availability')).toBe('Two weeks')
    expect(getCVFieldDraftValue(updated, experience, source.sections.experience[0]!.id, 'teamSize')).toBe('8 engineers')
    expect(updated.sections.experience[0]!.highlights).toEqual(['Team size: this is a genuine achievement'])
  })

  it('opens a tree node from the keyboard and Escape cancels without dirtying the draft', () => {
    render(<DraftEditor />)

    const nodeTarget = screen.getByRole('treeitem', { name: 'Thông tin cá nhân' })
    expect(nodeTarget).toHaveAttribute('tabindex', '0')
    nodeTarget.focus()
    fireEvent.keyDown(nodeTarget, { key: 'Enter' })

    const editor = screen.getByRole('dialog', { name: 'Chỉnh sửa Thông tin cá nhân' })
    expect(editor).toBeInTheDocument()
    fireEvent.keyDown(editor, { key: 'Escape' })

    expect(screen.queryByRole('dialog', { name: 'Chỉnh sửa Thông tin cá nhân' })).not.toBeInTheDocument()
    expect(screen.queryByText('Bản nháp chưa lưu')).not.toBeInTheDocument()
  })

  it('uses ComponentTree as the only section control surface', () => {
    render(<DraftEditor />)

    expect(screen.queryByTitle('Chỉnh sửa phần này')).not.toBeInTheDocument()
    expect(screen.queryByText('Chỉnh sửa: intro')).not.toBeInTheDocument()
    expect(screen.getByRole('tree', { name: 'Cấu trúc CV' })).toBeInTheDocument()
  })

  it('opens a canvas node from Space and preserves Escape cancellation', () => {
    render(<DraftEditor />)

    const canvasNode = screen.getByTestId('cv-block-header')
    expect(canvasNode).toHaveAttribute('tabindex', '0')
    canvasNode.focus()
    fireEvent.keyDown(canvasNode, { key: ' ' })

    expect(screen.getByRole('dialog', { name: 'Chỉnh sửa Thông tin cá nhân' })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('edits the complete Intro data through the ComponentTree nodes', () => {
    render(<DraftEditor />)

    fireEvent.doubleClick(screen.getByTestId('cv-block-header'))
    fireEvent.change(screen.getByLabelText('Website'), { target: { value: 'https://example.com' } })
    fireEvent.change(screen.getByLabelText('Career objective'), { target: { value: 'Build useful products' } })
    fireEvent.change(screen.getByLabelText('Availability'), { target: { value: 'Immediately' } })
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter', ctrlKey: true })

    fireEvent.doubleClick(screen.getByTestId('cv-block-summary'))
    fireEvent.change(screen.getByLabelText('Intro'), { target: { value: 'AI engineer focused on reliable systems.' } })
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter', ctrlKey: true })

    expect(screen.getByTestId('cv-block-header')).toHaveTextContent('https://example.com')
    expect(screen.getByTestId('cv-block-header')).toHaveTextContent('Immediately')
    expect(screen.getByTestId('cv-block-summary')).toHaveTextContent('Build useful products')
    expect(screen.getByTestId('cv-block-summary')).toHaveTextContent('AI engineer focused on reliable systems.')
  })

  it('opens a nested tree item from Space and applies its Enter edit to the draft', () => {
    render(<DraftEditor />)

    fireEvent.click(screen.getByRole('button', { name: 'Mở rộng Kinh nghiệm làm việc' }))
    const itemTarget = screen.getByRole('treeitem', { name: 'AI Engineer — IMESPRO' })
    expect(itemTarget).toHaveAttribute('tabindex', '0')
    itemTarget.focus()
    fireEvent.keyDown(itemTarget, { key: ' ' })

    const editor = screen.getByRole('dialog', { name: 'Chỉnh sửa Kinh nghiệm làm việc' })
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'Principal AI Engineer' } })
    fireEvent.keyDown(editor, { key: 'Enter' })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('cv-block-experience')).toHaveTextContent('Principal AI Engineer')
    expect(screen.getByText('Bản nháp chưa lưu')).toBeInTheDocument()
  })

  it('opens a nested canvas item from Enter and applies its Ctrl+Enter edit to the draft', () => {
    render(<DraftEditor />)

    const itemTarget = screen.getByTestId('cv-block-experience').querySelector<HTMLElement>('[data-cv-item-id="exp-1"]')
    expect(itemTarget).not.toBeNull()
    expect(itemTarget).toHaveAttribute('tabindex', '0')
    itemTarget!.focus()
    fireEvent.keyDown(itemTarget!, { key: 'Enter' })

    const editor = screen.getByRole('dialog', { name: 'Chỉnh sửa Kinh nghiệm làm việc' })
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'Lead AI Engineer' } })
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('cv-block-experience')).toHaveTextContent('Lead AI Engineer')
    expect(screen.getByText('Bản nháp chưa lưu')).toBeInTheDocument()
  })

  it('opens from a double-click, applies a text field to the draft, and shows dirty state', () => {
    render(<DraftEditor />)

    const editor = openExperienceItem()
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'Staff AI Engineer' } })
    fireEvent.keyDown(editor, { key: 'Enter' })

    expect(screen.queryByRole('dialog', { name: 'Chỉnh sửa Kinh nghiệm làm việc' })).not.toBeInTheDocument()
    expect(screen.getByTestId('cv-block-experience')).toHaveTextContent('Staff AI Engineer')
    expect(screen.getByText('Bản nháp chưa lưu')).toBeInTheDocument()
  })

  it('adds and maps careerObjective, teamSize, time, techStack, and contribution without a commit', () => {
    render(<DraftEditor />)

    fireEvent.doubleClick(screen.getByTestId('cv-block-header'))
    fireEvent.change(screen.getByLabelText('Career objective'), { target: { value: 'Build reliable HR tools' } })
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter', ctrlKey: true })
    expect(screen.getByText('Build reliable HR tools')).toBeInTheDocument()

    openExperienceItem()
    fireEvent.change(screen.getByLabelText('Team size'), { target: { value: '6 engineers' } })
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '2025-01' } })
    fireEvent.change(screen.getByLabelText('End time'), { target: { value: '2026-01' } })
    fireEvent.change(screen.getByLabelText('Tech stack'), { target: { value: 'React, TypeScript' } })
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter', ctrlKey: true })
    expect(screen.getByTestId('cv-block-experience').querySelector('[data-cv-field="time"]')).toHaveTextContent('2025-01 – Present')

    openProjectItem()
    fireEvent.change(screen.getByLabelText('Contribution'), { target: { value: 'Led delivery across the product team.' } })
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter', ctrlKey: true })
    expect(screen.getByTestId('cv-block-projects')).toHaveTextContent('Contribution: Led delivery across the product team.')
  })

  it('hides the layout component while keeping the source item editable and does not offer disallowed fields', () => {
    render(<DraftEditor />)

    fireEvent.click(screen.getByRole('button', { name: 'Ẩn Kinh nghiệm làm việc' }))
    expect(screen.queryByTestId('cv-block-experience')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Mở rộng Kinh nghiệm làm việc' }))
    const treeItem = screen.getByRole('treeitem', { name: /AI Engineer — IMESPRO/ })
    fireEvent.doubleClick(treeItem)
    expect(screen.getByRole('dialog', { name: 'Chỉnh sửa Kinh nghiệm làm việc' })).toBeInTheDocument()
    expect(screen.getByLabelText('Role')).toHaveValue('AI Engineer')
    expect(screen.queryByRole('button', { name: 'Thêm Career objective' })).not.toBeInTheDocument()
  })

  it('cancels local field edits with Escape', () => {
    render(<DraftEditor />)

    const editor = openExperienceItem()
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'Discard me' } })
    fireEvent.keyDown(editor, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('cv-block-experience')).toHaveTextContent('AI Engineer')
    expect(screen.queryByText('Bản nháp chưa lưu')).not.toBeInTheDocument()
  })
})
