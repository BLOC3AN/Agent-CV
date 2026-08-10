import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ComponentTree } from '../src/components/ComponentTree'
import { initialCVs } from '../src/mockData'
import type { CVLayout } from '../src/types'

const cv = initialCVs[0]!
const layout: CVLayout = {
  version: 1,
  nodes: [
    { id: 'header', type: 'header', visible: true },
    { id: 'experience', type: 'experience', visible: true, itemOrder: ['exp-1', 'exp-2'] },
    { id: 'skills', type: 'skills', visible: true },
  ],
}

function renderTree() {
  const onMoveNode = vi.fn()
  const onMoveItem = vi.fn()
  const onSetNodeVisible = vi.fn()
  const onSelect = vi.fn()
  const onEdit = vi.fn()
  render(
    <ComponentTree
      cv={cv}
      layout={layout}
      onMoveNode={onMoveNode}
      onMoveItem={onMoveItem}
      onSetNodeVisible={onSetNodeVisible}
      onSelect={onSelect}
      onEdit={onEdit}
    />,
  )
  return { onMoveNode, onMoveItem, onSetNodeVisible, onSelect, onEdit }
}

describe('ComponentTree', () => {
  it('uses native drag events through visible handles to request top-level and nested reorders', () => {
    const { onMoveNode, onMoveItem } = renderTree()

    const skillsHandle = screen.getByLabelText('Kéo Kỹ năng & Công nghệ')
    const experienceRow = screen.getByRole('treeitem', { name: /Kinh nghiệm làm việc/i })
    fireEvent.dragStart(skillsHandle)
    fireEvent.dragOver(experienceRow)
    fireEvent.drop(experienceRow)
    expect(onMoveNode).toHaveBeenCalledWith('skills', 'experience')

    fireEvent.click(screen.getByRole('button', { name: 'Mở rộng Kinh nghiệm làm việc' }))
    const secondItem = screen.getByRole('treeitem', { name: /AI Engineer — bTaskee/i })
    fireEvent.dragStart(screen.getByLabelText('Kéo AI Engineer — IMESPRO'))
    fireEvent.dragOver(secondItem)
    fireEvent.drop(secondItem)
    expect(onMoveItem).toHaveBeenCalledWith('experience', 'exp-1', 'exp-2')
  })

  it('selects, edits on double click, and hides a node through callbacks', () => {
    const { onEdit, onSelect, onSetNodeVisible } = renderTree()
    const experienceRow = screen.getByRole('treeitem', { name: /Kinh nghiệm làm việc/i })

    fireEvent.click(experienceRow)
    fireEvent.doubleClick(experienceRow)
    fireEvent.click(screen.getByRole('button', { name: 'Ẩn Kinh nghiệm làm việc' }))

    expect(onSelect).toHaveBeenCalledWith('experience')
    expect(onEdit).toHaveBeenCalledWith('experience')
    expect(onSetNodeVisible).toHaveBeenCalledWith('experience', false)
  })
})
