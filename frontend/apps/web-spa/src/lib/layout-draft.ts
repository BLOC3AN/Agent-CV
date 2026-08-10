import { DEFAULT_CV_LAYOUT } from '@hr/schema'
import type { CV, CVLayout, CVNodeType, LayoutNode } from '../types'

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
export function normalizeLayout(layout: CVLayout | undefined, activeSections?: CV['activeSections']): CVLayout {
  const defaults = cloneDefaultLayout()
  if (!layout || layout.version !== 1 || !Array.isArray(layout.nodes)) {
    return applyCompatibilityVisibility(defaults, activeSections)
  }
  const defaultByType = new Map(defaults.nodes.map((node) => [node.type, node]))
  const seen = new Set<CVNodeType>()
  const nodes: LayoutNode[] = []
  for (const candidate of layout.nodes) {
    const canonical = defaultByType.get(candidate?.type)
    if (!canonical || candidate.id !== candidate.type || typeof candidate.visible !== 'boolean' || seen.has(candidate.type)) {
      return applyCompatibilityVisibility(defaults, activeSections)
    }
    if ('itemOrder' in candidate && candidate.itemOrder && new Set(candidate.itemOrder).size !== candidate.itemOrder.length) {
      return applyCompatibilityVisibility(defaults, activeSections)
    }
    seen.add(candidate.type)
    nodes.push({ ...candidate, ...('itemOrder' in candidate && candidate.itemOrder ? { itemOrder: [...candidate.itemOrder] } : {}) } as LayoutNode)
  }
  for (const missing of defaults.nodes.filter((node) => !seen.has(node.type))) {
    const defaultIndex = defaults.nodes.findIndex((node) => node.type === missing.type)
    const before = nodes.findIndex((node) => defaults.nodes.findIndex((entry) => entry.type === node.type) > defaultIndex)
    nodes.splice(before < 0 ? nodes.length : before, 0, { ...missing } as LayoutNode)
  }
  return applyCompatibilityVisibility({ version: 1, nodes }, activeSections)
}

function applyCompatibilityVisibility(layout: CVLayout, activeSections?: CV['activeSections']): CVLayout {
  if (!activeSections) return layout
  return {
    ...layout,
    nodes: layout.nodes.map((node) => {
      const key = node.type === 'header' || node.type === 'summary' ? 'intro' : node.type === 'footer' ? undefined : node.type
      return key && activeSections[key] === false ? { ...node, visible: false } : node
    }),
  }
}

/** Keep compatibility flags readable while layout remains presentation authority. */
export function synchronizeCVActiveSections(cv: CV, layout: CVLayout): CV {
  const visible = (type: CVNodeType) => layout.nodes.find((node) => node.type === type)?.visible ?? true
  return {
    ...cv,
    activeSections: {
      intro: visible('header') || visible('summary'),
      experience: visible('experience'),
      projects: visible('projects'),
      education: visible('education'),
      skills: visible('skills'),
      activities: visible('activities'),
      certifications: visible('certifications'),
      languages: visible('languages'),
    },
  }
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
