import { DEFAULT_CV_LAYOUT } from '@hr/schema'
import type { CVLayout, LayoutNode } from '../types'

type ItemOrderNode = LayoutNode & { type: 'experience' | 'projects' | 'education' }

function isItemOrderNode(node: LayoutNode | undefined): node is ItemOrderNode {
  return node?.type === 'experience' || node?.type === 'projects' || node?.type === 'education'
}

function cloneDefaultLayout(): CVLayout {
  return {
    version: 1,
    nodes: DEFAULT_CV_LAYOUT.nodes.map((node) => ({
      ...node,
      ...('itemOrder' in node && node.itemOrder ? { itemOrder: [...node.itemOrder] } : {}),
    })) as LayoutNode[],
  }
}

/** Move one node before another node, or to the end when `beforeNodeId` is null. */
export function moveNode(layout: CVLayout, nodeId: string, beforeNodeId: string | null): CVLayout {
  const sourceIndex = layout.nodes.findIndex((node) => node.id === nodeId)
  if (sourceIndex < 0 || beforeNodeId === nodeId) return layout
  const beforeIndex = beforeNodeId === null
    ? -1
    : layout.nodes.findIndex((node) => node.id === beforeNodeId)
  if (beforeNodeId !== null && beforeIndex < 0) return layout

  const nodes = [...layout.nodes]
  const [node] = nodes.splice(sourceIndex, 1)
  if (!node) return layout
  const insertionIndex = beforeNodeId === null ? nodes.length : nodes.findIndex((candidate) => candidate.id === beforeNodeId)
  nodes.splice(insertionIndex, 0, node)
  return { ...layout, nodes }
}

/** Move a known nested item within an item-bearing layout node. */
export function moveItem(layout: CVLayout, nodeId: string, itemId: string, beforeItemId: string | null): CVLayout {
  const nodeIndex = layout.nodes.findIndex((node) => node.id === nodeId)
  const node = layout.nodes[nodeIndex]
  if (!isItemOrderNode(node) || !node.itemOrder) return layout
  const sourceIndex = node.itemOrder.indexOf(itemId)
  if (sourceIndex < 0 || beforeItemId === itemId) return layout
  const beforeIndex = beforeItemId === null ? -1 : node.itemOrder.indexOf(beforeItemId)
  if (beforeItemId !== null && beforeIndex < 0) return layout

  const itemOrder = [...node.itemOrder]
  const [item] = itemOrder.splice(sourceIndex, 1)
  if (!item) return layout
  const insertionIndex = beforeItemId === null ? itemOrder.length : itemOrder.indexOf(beforeItemId)
  itemOrder.splice(insertionIndex, 0, item)
  const nodes = [...layout.nodes]
  nodes[nodeIndex] = { ...node, itemOrder }
  return { ...layout, nodes }
}

/** Toggle only the layout visibility flag; CV section data always remains intact. */
export function setNodeVisible(layout: CVLayout, nodeId: string, visible: boolean): CVLayout {
  const nodeIndex = layout.nodes.findIndex((node) => node.id === nodeId)
  const node = layout.nodes[nodeIndex]
  if (!node || node.visible === visible) return layout
  const nodes = [...layout.nodes]
  nodes[nodeIndex] = { ...node, visible }
  return { ...layout, nodes }
}

/** Return a fresh copy of the registered default layout. */
export function resetDefaultLayout(_layout: CVLayout): CVLayout {
  return cloneDefaultLayout()
}

/** Accept legacy untyped API fixtures without letting malformed state reach a renderer. */
export function normalizeLayout(layout: CVLayout | undefined): CVLayout {
  if (!layout || layout.version !== 1 || !Array.isArray(layout.nodes)) return cloneDefaultLayout()
  const validTypes = new Set(['header', 'summary', 'experience', 'projects', 'education', 'skills', 'certifications', 'languages', 'footer'])
  if (!layout.nodes.every((node) => node && typeof node.id === 'string' && typeof node.visible === 'boolean' && validTypes.has(node.type))) return cloneDefaultLayout()
  return layout
}

/**
 * Nested item order is optional in persisted layouts. The UI materializes the
 * current CV ids before the first nested drag so the pure move operation can
 * reject unknown ids without needing access to CV content itself.
 */
export function materializeItemOrder(layout: CVLayout, nodeId: string, itemIds: string[]): CVLayout {
  const nodeIndex = layout.nodes.findIndex((node) => node.id === nodeId)
  const node = layout.nodes[nodeIndex]
  if (!isItemOrderNode(node)) return layout
  const validIds = new Set(itemIds)
  const current = (node.itemOrder ?? []).filter((id) => validIds.has(id))
  const itemOrder = [...current, ...itemIds.filter((id) => !current.includes(id))]
  if (node.itemOrder && node.itemOrder.length === itemOrder.length && node.itemOrder.every((id, index) => id === itemOrder[index])) return layout
  const nodes = [...layout.nodes]
  nodes[nodeIndex] = { ...node, itemOrder }
  return { ...layout, nodes }
}

export function hasDefaultNodeOrder(layout: CVLayout): boolean {
  const defaultLayout = cloneDefaultLayout()
  return layout.nodes.length === defaultLayout.nodes.length
    && layout.nodes.every((node, index) => node.id === defaultLayout.nodes[index]?.id)
}
