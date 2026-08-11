import type { CV } from '../types'

export type CVChangeKind = 'added' | 'removed' | 'changed'

/**
 * Change paths mirror the shape the renderer already walks, so a snapshot can
 * be highlighted without a second traversal:
 *
 *   intro.email                     — a field on the intro section
 *   experience.exp-1                — the whole entry appeared/disappeared/changed
 *   experience.exp-1.company        — a scalar field on that entry
 *   experience.exp-1.highlights.2   — one bullet inside that entry
 *
 * Kinds are stated from the newer snapshot's point of view. The two version
 * history panels each render a different snapshot, so a single map serves both:
 * only the "before" panel owns a `removed` path, only the "after" panel owns an
 * `added` one, and `changed` shows up on both sides of the comparison.
 */
export type CVChangeMap = Record<string, CVChangeKind>

const LIST_SECTIONS = ['experience', 'projects', 'education', 'skills', 'activities', 'certifications', 'languages'] as const

type ListSection = (typeof LIST_SECTIONS)[number]
type Indexed = Record<string, unknown> & { id: string }

function scalar(value: unknown): string {
  if (value == null) return ''
  return String(value)
}

function itemsById(items: unknown): Map<string, Indexed> {
  if (!Array.isArray(items)) return new Map()
  return new Map(items.filter((item): item is Indexed => Boolean(item?.id)).map((item) => [item.id, item]))
}

function diffList(changes: CVChangeMap, section: ListSection, before: unknown, after: unknown): void {
  const previousItems = itemsById(before)
  const nextItems = itemsById(after)

  for (const id of previousItems.keys()) {
    if (!nextItems.has(id)) changes[`${section}.${id}`] = 'removed'
  }

  for (const [id, item] of nextItems) {
    const previous = previousItems.get(id)
    if (!previous) {
      changes[`${section}.${id}`] = 'added'
      continue
    }
    let touched = false
    for (const key of new Set([...Object.keys(previous), ...Object.keys(item)])) {
      if (key === 'id') continue
      const previousValue = previous[key]
      const nextValue = item[key]
      if (Array.isArray(previousValue) || Array.isArray(nextValue)) {
        const previousEntries = Array.isArray(previousValue) ? previousValue : []
        const nextEntries = Array.isArray(nextValue) ? nextValue : []
        for (let index = 0; index < Math.max(previousEntries.length, nextEntries.length); index += 1) {
          if (scalar(previousEntries[index]) === scalar(nextEntries[index])) continue
          changes[`${section}.${id}.${key}.${index}`] = previousEntries[index] === undefined
            ? 'added'
            : nextEntries[index] === undefined ? 'removed' : 'changed'
          touched = true
        }
        continue
      }
      if (scalar(previousValue) === scalar(nextValue)) continue
      changes[`${section}.${id}.${key}`] = 'changed'
      touched = true
    }
    if (touched) changes[`${section}.${id}`] = 'changed'
  }
}

/** Compare two saved snapshots so the version history can point at what moved. */
export function diffCVSnapshots(before: CV | undefined, after: CV | undefined): CVChangeMap {
  const changes: CVChangeMap = {}
  if (!before?.sections || !after?.sections) return changes

  const previousIntro = (before.sections.intro ?? {}) as Record<string, unknown>
  const nextIntro = (after.sections.intro ?? {}) as Record<string, unknown>
  for (const key of new Set([...Object.keys(previousIntro), ...Object.keys(nextIntro)])) {
    if (scalar(previousIntro[key]) !== scalar(nextIntro[key])) changes[`intro.${key}`] = 'changed'
  }

  for (const section of LIST_SECTIONS) {
    diffList(changes, section, before.sections[section], after.sections[section])
  }

  return changes
}

/**
 * Entry-level totals for the panel summary. Nested field paths are folded into
 * their entry so a rewritten job reads as one change, not eight.
 */
export function countCVChanges(changes: CVChangeMap): { added: number; removed: number; changed: number; total: number } {
  const totals = { added: 0, removed: 0, changed: 0, total: 0 }
  for (const [path, kind] of Object.entries(changes)) {
    // `intro.email` and `experience.exp-1` are both entry level; anything
    // deeper is a field inside an entry already counted here.
    if (path.split('.').length !== 2) continue
    totals[kind] += 1
    totals.total += 1
  }
  return totals
}
