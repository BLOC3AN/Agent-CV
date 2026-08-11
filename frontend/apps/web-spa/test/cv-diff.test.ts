import { describe, expect, it } from 'vitest'
import { countCVChanges, diffCVSnapshots } from '../src/lib/cv-diff'
import { initialCVs } from '../src/mockData'
import type { CV } from '../src/types'

const base = initialCVs[0]!

function edited(mutate: (cv: CV) => void): CV {
  const next = structuredClone(base)
  mutate(next)
  return next
}

describe('cv snapshot diff', () => {
  it('reports nothing for two identical snapshots', () => {
    expect(diffCVSnapshots(base, structuredClone(base))).toEqual({})
  })

  it('marks a changed intro field by name', () => {
    const after = edited((cv) => { cv.sections.intro.email = 'new@example.com' })

    const changes = diffCVSnapshots(base, after)

    expect(changes['intro.email']).toBe('changed')
    expect(changes['intro.fullName']).toBeUndefined()
  })

  it('marks a scalar field change and rolls it up onto the owning entry', () => {
    const target = base.sections.experience[0]!
    const after = edited((cv) => { cv.sections.experience[0]!.company = 'Another company' })

    const changes = diffCVSnapshots(base, after)

    expect(changes[`experience.${target.id}.company`]).toBe('changed')
    expect(changes[`experience.${target.id}`]).toBe('changed')
  })

  it('diffs list fields element by element so one rewritten bullet stays one bullet', () => {
    const target = base.sections.experience[0]!
    const after = edited((cv) => {
      cv.sections.experience[0]!.highlights = [...target.highlights]
      cv.sections.experience[0]!.highlights[1] = 'Rewritten bullet'
      cv.sections.experience[0]!.highlights.push('Brand new bullet')
    })

    const changes = diffCVSnapshots(base, after)

    expect(changes[`experience.${target.id}.highlights.1`]).toBe('changed')
    expect(changes[`experience.${target.id}.highlights.${target.highlights.length}`]).toBe('added')
    expect(changes[`experience.${target.id}.highlights.0`]).toBeUndefined()
  })

  it('states added and removed entries from the newer snapshot point of view', () => {
    const removedId = base.sections.experience[0]!.id
    const after = edited((cv) => {
      cv.sections.experience = cv.sections.experience.slice(1)
      cv.sections.experience.push({ id: 'exp-new', title: 'New role', company: 'New co', startDate: '2026', endDate: '', current: true, highlights: [] })
    })

    const changes = diffCVSnapshots(base, after)

    expect(changes[`experience.${removedId}`]).toBe('removed')
    expect(changes['experience.exp-new']).toBe('added')
  })

  it('returns an empty diff when either snapshot is missing', () => {
    expect(diffCVSnapshots(undefined, base)).toEqual({})
    expect(diffCVSnapshots(base, undefined)).toEqual({})
  })

  it('counts entries rather than fields so a rewritten job reads as one change', () => {
    const after = edited((cv) => {
      cv.sections.experience[0]!.company = 'Another company'
      cv.sections.experience[0]!.title = 'Another title'
      cv.sections.intro.email = 'new@example.com'
    })

    expect(countCVChanges(diffCVSnapshots(base, after))).toEqual({ added: 0, removed: 0, changed: 2, total: 2 })
  })
})
