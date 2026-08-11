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

/** jsdom reports a zero rect for everything; midpoint logic needs a real one. */
function stubRect(element: HTMLElement, { top, height }: { top: number; height: number }) {
  element.getBoundingClientRect = () => ({ top, height, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) })
}

/**
 * jsdom's DragEvent is a stub: it ignores mouse coordinates from its init and
 * substitutes its own DataTransfer. Dispatching a MouseEvent under the drag
 * event name is what lets these tests observe the fields the component reads.
 */
function fireDrag(type: string, element: HTMLElement, init: { clientY?: number; dataTransfer?: unknown } = {}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY: init.clientY ?? 0 })
  if (init.dataTransfer) Object.defineProperty(event, 'dataTransfer', { value: init.dataTransfer })
  fireEvent(element, event)
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

  it('drops after the hovered row once the pointer crosses its midpoint', () => {
    const { onMoveNode } = renderTree()
    const headerHandle = screen.getByLabelText('Kéo Thông tin cá nhân')
    const experienceRow = screen.getByRole('treeitem', { name: /Kinh nghiệm làm việc/i })
    stubRect(experienceRow, { top: 100, height: 40 })

    // Dropping on the top half of the neighbour below would resolve to "insert
    // before experience" — the position header already holds — so the reorder
    // is only observable from the bottom half.
    fireEvent.dragStart(headerHandle)
    fireDrag('dragover', experienceRow, { clientY: 130 })
    fireDrag('drop', experienceRow, { clientY: 130 })

    expect(onMoveNode).toHaveBeenCalledWith('header', 'skills')
  })

  it('treats the drop placeholder as a live drop surface', () => {
    const { onMoveNode } = renderTree()
    const skillsHandle = screen.getByLabelText('Kéo Kỹ năng & Công nghệ')
    const experienceRow = screen.getByRole('treeitem', { name: /Kinh nghiệm làm việc/i })

    fireEvent.dragStart(skillsHandle)
    fireEvent.dragOver(experienceRow)

    // The placeholder is inserted above the hovered row and takes the pointer
    // with it, so a drop that lands there must still commit the reorder.
    fireEvent.drop(screen.getByTestId('component-tree-drop-placeholder'))

    expect(onMoveNode).toHaveBeenCalledWith('skills', 'experience')
  })

  it('carries a drag payload so browsers that require one still start the drag', () => {
    renderTree()
    const dataTransfer = { effectAllowed: '', setData: vi.fn(), dropEffect: '' }

    fireDrag('dragstart', screen.getByLabelText('Kéo Kỹ năng & Công nghệ'), { dataTransfer })

    expect(dataTransfer.effectAllowed).toBe('move')
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'skills')
  })

  it('shows a drop placeholder while a node is dragged over a new position and clears it on cancel', () => {
    renderTree()
    const skillsHandle = screen.getByLabelText('Kéo Kỹ năng & Công nghệ')
    const experienceRow = screen.getByRole('treeitem', { name: /Kinh nghiệm làm việc/i })

    fireEvent.dragStart(skillsHandle)
    fireEvent.dragOver(experienceRow)

    expect(screen.getByTestId('component-tree-drop-placeholder')).toBeInTheDocument()
    expect(skillsHandle).toHaveAttribute('data-dragging', 'true')

    fireEvent.dragEnd(skillsHandle)
    expect(screen.queryByTestId('component-tree-drop-placeholder')).not.toBeInTheDocument()
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
