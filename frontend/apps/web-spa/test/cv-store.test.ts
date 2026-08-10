// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useCVStore } from '../src/lib/cv-store.js'
import * as api from '../src/lib/api.js'
import type { CV, CVLayout } from '../src/types.js'
import { CVSchema, DEFAULT_CV_LAYOUT } from '@hr/schema'
import { applyChatOpsToDraft } from '../src/lib/cv-patch.js'

const cv = {
  id: 'cv-1',
  title: 'CV',
  lastModified: '',
  sections: { intro: { fullName: 'A', title: '', email: '', phone: '', location: '', summary: '' }, experience: [], projects: [], education: [], skills: [], activities: [], certifications: [], languages: [] },
  design: { template: 'modern', accentColor: '#000', font: 'Roboto', fontSize: 14, spacing: 'normal' },
  activeSections: { intro: true, experience: true, projects: true, education: true, skills: true, activities: true, certifications: true, languages: true },
} as CV

const layout = structuredClone(DEFAULT_CV_LAYOUT) as CVLayout

function envelope(profileSnapshot = cv, savedLayout = layout, revisionNumber = 0) {
  return { id: 'cv-1', profileId: 'profile-1', layout: savedLayout, profileSnapshot, revisionNumber } as never
}

function commitResult(profileSnapshot: CV, revisionNumber: number, savedLayout = layout) {
  return { cv: envelope(profileSnapshot, savedLayout, revisionNumber), revision: { number: revisionNumber } } as never
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

afterEach(() => vi.restoreAllMocks())

describe('useCVStore', () => {
  it('keeps edits local until saveDraft is requested', async () => {
    vi.spyOn(api, 'getCV').mockResolvedValue(envelope())
    const commit = vi.spyOn(api, 'commitCV').mockResolvedValue({ cv: envelope() } as never)
    const legacySave = vi.spyOn(api, 'saveCV').mockResolvedValue(undefined)
    const { result } = renderHook(() => useCVStore('cv-1'))
    await waitFor(() => expect(result.current.draft?.cv).toEqual(cv))

    act(() => result.current.updateDraft({ cv: { ...cv, title: 'Đang soạn' }, layout }))

    expect(result.current.draft?.cv.title).toBe('Đang soạn')
    expect(result.current.committed?.cv.title).toBe('CV')
    expect(result.current.dirty).toBe(true)
    expect(commit).not.toHaveBeenCalled()
    expect(legacySave).not.toHaveBeenCalled()
  })

  it('commits the draft once and makes the committed copy current', async () => {
    vi.spyOn(api, 'getCV').mockResolvedValue(envelope())
    const updated = { ...cv, title: 'Đã lưu' }
    const commit = vi.spyOn(api, 'commitCV').mockResolvedValue(commitResult(updated, 1))
    const { result } = renderHook(() => useCVStore('cv-1'))
    await waitFor(() => expect(result.current.draft?.cv).toEqual(cv))
    act(() => result.current.updateDraft({ cv: updated, layout }))

    await act(async () => result.current.saveDraft())

    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith('cv-1', updated, layout, 'user', undefined, 0)
    expect(result.current.committed).toEqual({ cv: updated, layout })
    expect(result.current.draft).toEqual({ cv: updated, layout })
    expect(result.current.dirty).toBe(false)
  })

  it('discards the local draft and restores the committed document', async () => {
    vi.spyOn(api, 'getCV').mockResolvedValue(envelope())
    const { result } = renderHook(() => useCVStore('cv-1'))
    await waitFor(() => expect(result.current.draft?.cv).toEqual(cv))
    act(() => result.current.updateDraft({ cv: { ...cv, title: 'Bỏ thay đổi này' }, layout }))

    act(() => result.current.discardDraft())

    expect(result.current.draft).toEqual({ cv, layout })
    expect(result.current.dirty).toBe(false)
    expect(result.current.status).toBe('ready')
  })

  it('does not mark a structurally equivalent document dirty when key order differs', async () => {
    vi.spyOn(api, 'getCV').mockResolvedValue(envelope())
    const { result } = renderHook(() => useCVStore('cv-1'))
    await waitFor(() => expect(result.current.draft?.cv).toEqual(cv))

    act(() => result.current.updateDraft({
      cv: { activeSections: cv.activeSections, design: cv.design, sections: cv.sections, lastModified: cv.lastModified, title: cv.title, id: cv.id },
      layout: { nodes: [{ visible: true, type: 'header', id: 'header' }], version: 1 },
    }))

    expect(result.current.dirty).toBe(false)
    expect(result.current.status).toBe('ready')
  })

  it('shares one in-flight promise when saveDraft is called twice synchronously', async () => {
    vi.spyOn(api, 'getCV').mockResolvedValue(envelope())
    const pending = deferred<{ cv: ReturnType<typeof envelope> }>()
    const commit = vi.spyOn(api, 'commitCV').mockReturnValue(pending.promise as never)
    const { result } = renderHook(() => useCVStore('cv-1'))
    await waitFor(() => expect(result.current.draft?.cv).toEqual(cv))
    act(() => result.current.updateDraft({ cv: { ...cv, title: 'Một lần' }, layout }))

    let first!: Promise<void>
    let second!: Promise<void>
    act(() => {
      first = result.current.saveDraft()
      second = result.current.saveDraft()
    })
    expect(first).toBe(second)
    expect(commit).toHaveBeenCalledTimes(1)

    pending.resolve(commitResult({ ...cv, title: 'Một lần' }, 1))
    await act(async () => { await first })
  })

  it('keeps edits made while saving in the draft after the first save resolves', async () => {
    vi.spyOn(api, 'getCV').mockResolvedValue(envelope())
    const pending = deferred<{ cv: ReturnType<typeof envelope> }>()
    vi.spyOn(api, 'commitCV').mockReturnValue(pending.promise as never)
    const { result } = renderHook(() => useCVStore('cv-1'))
    await waitFor(() => expect(result.current.draft?.cv).toEqual(cv))
    act(() => result.current.updateDraft({ cv: { ...cv, title: 'Bản đầu' }, layout }))

    let save!: Promise<void>
    act(() => {
      save = result.current.saveDraft()
      result.current.updateDraft({ cv: { ...cv, title: 'Bản mới hơn' }, layout })
    })
    pending.resolve(commitResult({ ...cv, title: 'Bản đầu' }, 1))
    await act(async () => { await save })

    expect(result.current.committed?.cv.title).toBe('Bản đầu')
    expect(result.current.draft?.cv.title).toBe('Bản mới hơn')
    expect(result.current.dirty).toBe(true)
  })

  it('does not discard or report completion while a save that can commit is pending', async () => {
    vi.spyOn(api, 'getCV').mockResolvedValue(envelope())
    const pending = deferred<{ cv: ReturnType<typeof envelope> }>()
    vi.spyOn(api, 'commitCV').mockReturnValue(pending.promise as never)
    const { result } = renderHook(() => useCVStore('cv-1'))
    await waitFor(() => expect(result.current.draft?.cv).toEqual(cv))
    act(() => result.current.updateDraft({ cv: { ...cv, title: 'Không được bỏ' }, layout }))

    let save!: Promise<void>
    act(() => {
      save = result.current.saveDraft()
      result.current.discardDraft()
    })

    expect(result.current.saving).toBe(true)
    expect(result.current.draft?.cv.title).toBe('Không được bỏ')
    pending.resolve(commitResult({ ...cv, title: 'Không được bỏ' }, 1))
    await act(async () => { await save })
    expect(result.current.dirty).toBe(false)
  })

  it('keeps a stale-conflict draft dirty and does not advance its base revision', async () => {
    vi.spyOn(api, 'getCV').mockResolvedValue(envelope(cv, layout, 3))
    const commit = vi.spyOn(api, 'commitCV').mockRejectedValue(new api.ApiError(409, 'CV đã có phiên bản mới hơn'))
    const { result } = renderHook(() => useCVStore('cv-1'))
    await waitFor(() => expect(result.current.draft).not.toBeNull())
    act(() => result.current.updateDraft({ cv: { ...cv, title: 'Stale draft' }, layout }))

    await act(async () => { await expect(result.current.saveDraft()).rejects.toThrow(/phiên bản mới hơn/i) })

    expect(commit).toHaveBeenCalledWith('cv-1', expect.anything(), layout, 'user', undefined, 3)
    expect(result.current.dirty).toBe(true)
    expect(result.current.baseRevision).toBe(3)
  })

  it('refuses restore while dirty before issuing a network request', async () => {
    vi.spyOn(api, 'getCV').mockResolvedValue(envelope(cv, layout, 2))
    const restore = vi.spyOn(api, 'restoreCVRevision')
    const { result } = renderHook(() => useCVStore('cv-1'))
    await waitFor(() => expect(result.current.draft).not.toBeNull())
    act(() => result.current.updateDraft({ cv: { ...cv, title: 'Unsaved' }, layout }))

    await act(async () => { await expect(result.current.restoreRevision('revision-1')).rejects.toThrow(/chưa lưu/i) })
    expect(restore).not.toHaveBeenCalled()
    expect(result.current.draft?.cv.title).toBe('Unsaved')
  })

  it('keeps AI provenance through mixed manual edits and versions it across an in-flight save', async () => {
    vi.spyOn(api, 'getCV').mockResolvedValue(envelope())
    const first = deferred<api.CVCommitResult>()
    const commit = vi.spyOn(api, 'commitCV').mockReturnValueOnce(first.promise).mockResolvedValueOnce(commitResult({ ...cv, title: 'AI B plus manual' }, 2))
    const { result } = renderHook(() => useCVStore('cv-1'))
    await waitFor(() => expect(result.current.draft).not.toBeNull())
    act(() => result.current.applyAIDraft({ cv: { ...cv, title: 'AI A' }, layout }, 'AI A'))
    act(() => result.current.updateDraft({ cv: { ...cv, title: 'AI A plus manual' }, layout }))

    let saving!: Promise<void>
    act(() => { saving = result.current.saveDraft() })
    expect(commit).toHaveBeenLastCalledWith('cv-1', expect.objectContaining({ title: 'AI A plus manual' }), layout, 'ai', 'AI A', 0)
    act(() => result.current.applyAIDraft({ cv: { ...cv, title: 'AI B plus manual' }, layout }, 'AI B'))
    await act(async () => { first.resolve(commitResult({ ...cv, title: 'AI A plus manual' }, 1)); await saving })

    expect(result.current.pendingAIProvenance).toEqual(['AI B'])
    await act(async () => result.current.saveDraft())
    expect(commit).toHaveBeenLastCalledWith('cv-1', expect.objectContaining({ title: 'AI B plus manual' }), layout, 'ai', 'AI B', 1)
  })

  it('does not attribute a later manual save to an AI proposal that changed nothing', async () => {
    vi.spyOn(api, 'getCV').mockResolvedValue(envelope())
    const commit = vi.spyOn(api, 'commitCV').mockResolvedValue(commitResult({ ...cv, title: 'Manual change' }, 1))
    const { result } = renderHook(() => useCVStore('cv-1'))
    await waitFor(() => expect(result.current.draft).not.toBeNull())

    act(() => result.current.applyAIDraft({ cv, layout }, 'No-op AI'))
    expect(result.current.pendingAIProvenance).toEqual([])
    act(() => result.current.updateDraft({ cv: { ...cv, title: 'Manual change' }, layout }))
    await act(async () => result.current.saveDraft())

    expect(commit).toHaveBeenCalledWith('cv-1', expect.objectContaining({ title: 'Manual change' }), layout, 'user', undefined, 0)
  })

  it('reconciles AI provenance when manual editing reverts the AI contribution', async () => {
    vi.spyOn(api, 'getCV').mockResolvedValue(envelope())
    const commit = vi.spyOn(api, 'commitCV').mockResolvedValue(commitResult({ ...cv, title: 'Independent manual save' }, 1))
    const { result } = renderHook(() => useCVStore('cv-1'))
    await waitFor(() => expect(result.current.draft).not.toBeNull())

    act(() => result.current.applyAIDraft({ cv: { ...cv, title: 'AI proposal' }, layout }, 'AI proposal'))
    expect(result.current.pendingAIProvenance).toEqual(['AI proposal'])
    act(() => result.current.updateDraft({ cv: { ...cv, title: 'CV' }, layout }))
    expect(result.current.pendingAIProvenance).toEqual([])
    act(() => result.current.updateDraft({ cv: { ...cv, title: 'Independent manual save' }, layout }))
    await act(async () => result.current.saveDraft())

    expect(commit).toHaveBeenCalledWith('cv-1', expect.objectContaining({ title: 'Independent manual save' }), layout, 'user', undefined, 0)
  })

  it('accepts an optional-field remove proposal through chat ops and AI draft application', async () => {
    const source = CVSchema.parse({
      schemaVersion: 2, id: 'cv-1', title: 'CV', lastModified: '', language: 'vi',
      sections: { ...cv.sections, intro: { ...cv.sections.intro, availability: 'Now' } },
    }) as CV
    vi.spyOn(api, 'getCV').mockResolvedValue(envelope(source))
    vi.spyOn(api, 'commitCV').mockResolvedValue(commitResult(source, 1))
    const { result } = renderHook(() => useCVStore('cv-1'))
    await waitFor(() => expect(result.current.draft).not.toBeNull())

    const proposal = applyChatOpsToDraft(result.current.draft!, [{ op: 'remove', path: '/sections/intro/availability', rationale: 'Remove availability', grounding: { type: 'user_message', ref: 'Remove availability' } }])
    act(() => result.current.applyAIDraft(proposal, 'Remove availability'))

    expect(result.current.draft?.cv.sections.intro.availability).toBeUndefined()
    expect(result.current.pendingAIProvenance).toEqual(['Remove availability'])
  })

  it('labels a manual replacement as user after AI empties a string', async () => {
    vi.spyOn(api, 'getCV').mockResolvedValue(envelope())
    const commit = vi.spyOn(api, 'commitCV').mockResolvedValue(commitResult({ ...cv, title: 'Independent manual' }, 1))
    const { result } = renderHook(() => useCVStore('cv-1'))
    await waitFor(() => expect(result.current.draft).not.toBeNull())

    act(() => result.current.applyAIDraft({ cv: { ...cv, title: '' }, layout }, 'AI blanked title'))
    act(() => result.current.updateDraft({ cv: { ...cv, title: 'Independent manual' }, layout }))
    expect(result.current.pendingAIProvenance).toEqual([])
    await act(async () => result.current.saveDraft())

    expect(commit).toHaveBeenCalledWith('cv-1', expect.objectContaining({ title: 'Independent manual' }), layout, 'user', undefined, 0)
  })

  it('preserves AI array provenance when a manual edit appends to the same array', async () => {
    const source = CVSchema.parse({
      schemaVersion: 2, id: 'cv-1', title: 'CV', lastModified: '', language: 'vi',
      sections: {
        ...cv.sections,
        experience: [{ id: 'exp-1', title: 'Engineer', company: '', highlights: ['Existing'] }],
      },
    }) as CV
    vi.spyOn(api, 'getCV').mockResolvedValue(envelope(source))
    const commit = vi.spyOn(api, 'commitCV').mockResolvedValue(commitResult(source, 1))
    const { result } = renderHook(() => useCVStore('cv-1'))
    await waitFor(() => expect(result.current.draft).not.toBeNull())

    const proposal = applyChatOpsToDraft(result.current.draft!, [{
      op: 'add', path: '/sections/experience/0/highlights/-', value: 'AI bullet',
      rationale: 'Add measurable highlight', grounding: { type: 'user_message', ref: 'Add highlight' },
    }])
    act(() => result.current.applyAIDraft(proposal, 'Add AI highlight'))
    const manual = result.current.getDraft()!
    act(() => result.current.updateDraft({
      cv: { ...manual.cv, sections: { ...manual.cv.sections, experience: [{ ...manual.cv.sections.experience[0]!, highlights: ['AI bullet', 'Manual first', 'Existing'] }] } },
      layout: manual.layout,
    }))
    await act(async () => result.current.saveDraft())

    expect(commit).toHaveBeenCalledWith('cv-1', expect.objectContaining({ sections: expect.objectContaining({ experience: [expect.objectContaining({ highlights: ['AI bullet', 'Manual first', 'Existing'] })] }) }), expect.anything(), 'ai', 'Add AI highlight', 0)
  })

  it('preserves AI removal provenance when a manual edit changes the same array', async () => {
    const source = CVSchema.parse({
      schemaVersion: 2, id: 'cv-1', title: 'CV', lastModified: '', language: 'vi',
      sections: { ...cv.sections, experience: [{ id: 'exp-1', title: 'Engineer', company: '', highlights: ['Existing', 'AI remove me'] }] },
    }) as CV
    vi.spyOn(api, 'getCV').mockResolvedValue(envelope(source))
    const commit = vi.spyOn(api, 'commitCV').mockResolvedValue(commitResult(source, 1))
    const { result } = renderHook(() => useCVStore('cv-1'))
    await waitFor(() => expect(result.current.draft).not.toBeNull())

    const proposal = applyChatOpsToDraft(result.current.draft!, [{
      op: 'remove', path: '/sections/experience/0/highlights/1',
      rationale: 'Remove stale highlight', grounding: { type: 'user_message', ref: 'Remove highlight' },
    }])
    act(() => result.current.applyAIDraft(proposal, 'Remove AI highlight'))
    const manual = result.current.getDraft()!
    act(() => result.current.updateDraft({
      cv: { ...manual.cv, sections: { ...manual.cv.sections, experience: [{ ...manual.cv.sections.experience[0]!, highlights: ['Existing', 'Manual follow-up'] }] } },
      layout: manual.layout,
    }))
    await act(async () => result.current.saveDraft())

    expect(commit).toHaveBeenCalledWith('cv-1', expect.objectContaining({ sections: expect.objectContaining({ experience: [expect.objectContaining({ highlights: ['Existing', 'Manual follow-up'] })] }) }), expect.anything(), 'ai', 'Remove AI highlight', 0)
  })

  it('clears duplicate primitive-add provenance when the added copy is undone', async () => {
    const source = CVSchema.parse({
      schemaVersion: 2, id: 'cv-1', title: 'CV', lastModified: '', language: 'vi',
      sections: { ...cv.sections, experience: [{ id: 'exp-1', title: 'Engineer', company: '', highlights: ['Duplicate'] }] },
    }) as CV
    vi.spyOn(api, 'getCV').mockResolvedValue(envelope(source))
    const commit = vi.spyOn(api, 'commitCV').mockResolvedValue(commitResult(source, 1))
    const { result } = renderHook(() => useCVStore('cv-1'))
    await waitFor(() => expect(result.current.draft).not.toBeNull())
    const proposal = applyChatOpsToDraft(result.current.draft!, [{ op: 'add', path: '/sections/experience/0/highlights/-', value: 'Duplicate', rationale: 'Add duplicate', grounding: { type: 'user_message', ref: 'Duplicate' } }])
    act(() => result.current.applyAIDraft(proposal, 'Add duplicate'))
    const manual = result.current.getDraft()!
    act(() => result.current.updateDraft({ cv: { ...manual.cv, title: 'Manual save', sections: { ...manual.cv.sections, experience: [{ ...manual.cv.sections.experience[0]!, highlights: ['Duplicate'] }] } }, layout: manual.layout }))
    await act(async () => result.current.saveDraft())
    expect(commit).toHaveBeenCalledWith('cv-1', expect.anything(), expect.anything(), 'user', undefined, 0)
  })

  it('clears AI reorder provenance when manual order is restored', async () => {
    const source = CVSchema.parse({
      schemaVersion: 2, id: 'cv-1', title: 'CV', lastModified: '', language: 'vi',
      sections: { ...cv.sections, experience: [{ id: 'exp-1', title: 'Engineer', company: '', techStack: ['Go', 'React'] }] },
    }) as CV
    vi.spyOn(api, 'getCV').mockResolvedValue(envelope(source))
    const commit = vi.spyOn(api, 'commitCV').mockResolvedValue(commitResult(source, 1))
    const { result } = renderHook(() => useCVStore('cv-1'))
    await waitFor(() => expect(result.current.draft).not.toBeNull())
    const proposal = applyChatOpsToDraft(result.current.draft!, [{ op: 'replace', path: '/sections/experience/0/techStack', value: ['React', 'Go'], rationale: 'Reorder stack', grounding: { type: 'user_message', ref: 'Reorder' } }])
    act(() => result.current.applyAIDraft(proposal, 'Reorder stack'))
    const manual = result.current.getDraft()!
    act(() => result.current.updateDraft({ cv: { ...manual.cv, title: 'Manual save', sections: { ...manual.cv.sections, experience: [{ ...manual.cv.sections.experience[0]!, techStack: ['Go', 'React'] }] } }, layout: manual.layout }))
    await act(async () => result.current.saveDraft())
    expect(commit).toHaveBeenCalledWith('cv-1', expect.anything(), expect.anything(), 'user', undefined, 0)
  })

  it('keeps a nested AI field attributed when stable-ID items are reordered manually', async () => {
    const source = CVSchema.parse({
      schemaVersion: 2, id: 'cv-1', title: 'CV', lastModified: '', language: 'vi',
      sections: { ...cv.sections, experience: [{ id: 'exp-1', title: 'Engineer', company: '' }, { id: 'exp-2', title: 'Designer', company: '' }] },
    }) as CV
    vi.spyOn(api, 'getCV').mockResolvedValue(envelope(source))
    const commit = vi.spyOn(api, 'commitCV').mockResolvedValue(commitResult(source, 1))
    const { result } = renderHook(() => useCVStore('cv-1'))
    await waitFor(() => expect(result.current.draft).not.toBeNull())
    const proposal = applyChatOpsToDraft(result.current.draft!, [{ op: 'replace', path: '/sections/experience/0/title', value: 'AI Engineer', rationale: 'Improve role', grounding: { type: 'user_message', ref: 'Role' } }])
    act(() => result.current.applyAIDraft(proposal, 'Improve role'))
    const manual = result.current.getDraft()!
    act(() => result.current.updateDraft({ cv: { ...manual.cv, sections: { ...manual.cv.sections, experience: [manual.cv.sections.experience[1]!, manual.cv.sections.experience[0]!] } }, layout: manual.layout }))
    await act(async () => result.current.saveDraft())
    expect(commit).toHaveBeenCalledWith('cv-1', expect.objectContaining({ sections: expect.objectContaining({ experience: [expect.objectContaining({ id: 'exp-2' }), expect.objectContaining({ id: 'exp-1', title: 'AI Engineer' })] }) }), expect.anything(), 'ai', 'Improve role', 0)
  })

  it('clears AI item-removal provenance when the same item ID is re-added with changed fields', async () => {
    const source = CVSchema.parse({
      schemaVersion: 2, id: 'cv-1', title: 'CV', lastModified: '', language: 'vi',
      sections: { ...cv.sections, experience: [{ id: 'exp-1', title: 'Engineer', company: '' }, { id: 'exp-2', title: 'Designer', company: '' }] },
    }) as CV
    vi.spyOn(api, 'getCV').mockResolvedValue(envelope(source))
    const commit = vi.spyOn(api, 'commitCV').mockResolvedValue(commitResult(source, 1))
    const { result } = renderHook(() => useCVStore('cv-1'))
    await waitFor(() => expect(result.current.draft).not.toBeNull())
    const proposal = applyChatOpsToDraft(result.current.draft!, [{ op: 'remove', path: '/sections/experience/0', rationale: 'Remove role', grounding: { type: 'user_message', ref: 'Remove role' } }])
    act(() => result.current.applyAIDraft(proposal, 'Remove role'))
    const manual = result.current.getDraft()!
    act(() => result.current.updateDraft({ cv: { ...manual.cv, sections: { ...manual.cv.sections, experience: [{ id: 'exp-1', title: 'Manual replacement', company: 'New Co', startDate: '', endDate: '', current: false, highlights: [] }, manual.cv.sections.experience[0]!] } }, layout: manual.layout }))
    await act(async () => result.current.saveDraft())
    expect(commit).toHaveBeenCalledWith('cv-1', expect.anything(), expect.anything(), 'user', undefined, 0)
  })

  it('keeps AI reorder provenance when a manual append preserves relative AI order', async () => {
    const source = CVSchema.parse({
      schemaVersion: 2, id: 'cv-1', title: 'CV', lastModified: '', language: 'vi',
      sections: { ...cv.sections, experience: [{ id: 'exp-1', title: 'Engineer', company: '', techStack: ['Go', 'React'] }] },
    }) as CV
    vi.spyOn(api, 'getCV').mockResolvedValue(envelope(source))
    const commit = vi.spyOn(api, 'commitCV').mockResolvedValue(commitResult(source, 1))
    const { result } = renderHook(() => useCVStore('cv-1'))
    await waitFor(() => expect(result.current.draft).not.toBeNull())
    const proposal = applyChatOpsToDraft(result.current.draft!, [{ op: 'replace', path: '/sections/experience/0/techStack', value: ['React', 'Go'], rationale: 'Reorder stack', grounding: { type: 'user_message', ref: 'Reorder' } }])
    act(() => result.current.applyAIDraft(proposal, 'Reorder stack'))
    const manual = result.current.getDraft()!
    act(() => result.current.updateDraft({ cv: { ...manual.cv, sections: { ...manual.cv.sections, experience: [{ ...manual.cv.sections.experience[0]!, techStack: ['React', 'Go', 'Vue'] }] } }, layout: manual.layout }))
    await act(async () => result.current.saveDraft())
    expect(commit).toHaveBeenCalledWith('cv-1', expect.objectContaining({ sections: expect.objectContaining({ experience: [expect.objectContaining({ techStack: ['React', 'Go', 'Vue'] })] }) }), expect.anything(), 'ai', 'Reorder stack', 0)
  })

  it('decomposes an AI-created optional array before a manual append', async () => {
    const source = CVSchema.parse({
      schemaVersion: 2, id: 'cv-1', title: 'CV', lastModified: '', language: 'vi',
      sections: { ...cv.sections, experience: [{ id: 'exp-1', title: 'Engineer', company: '' }] },
    }) as CV
    vi.spyOn(api, 'getCV').mockResolvedValue(envelope(source))
    const commit = vi.spyOn(api, 'commitCV').mockResolvedValue(commitResult(source, 1))
    const { result } = renderHook(() => useCVStore('cv-1'))
    await waitFor(() => expect(result.current.draft).not.toBeNull())
    const proposal = applyChatOpsToDraft(result.current.draft!, [{ op: 'add', path: '/sections/experience/0/techStack', value: ['Go'], rationale: 'Add stack', grounding: { type: 'user_message', ref: 'Stack' } }])
    act(() => result.current.applyAIDraft(proposal, 'Add stack'))
    const manual = result.current.getDraft()!
    act(() => result.current.updateDraft({ cv: { ...manual.cv, sections: { ...manual.cv.sections, experience: [{ ...manual.cv.sections.experience[0]!, techStack: ['Go', 'React'] }] } }, layout: manual.layout }))
    await act(async () => result.current.saveDraft())
    expect(commit).toHaveBeenCalledWith('cv-1', expect.anything(), expect.anything(), 'ai', 'Add stack', 0)
  })

  it('follows an AI nested array add after stable-ID item reorder', async () => {
    const source = CVSchema.parse({
      schemaVersion: 2, id: 'cv-1', title: 'CV', lastModified: '', language: 'vi',
      sections: { ...cv.sections, experience: [{ id: 'exp-1', title: 'Engineer', company: '' }, { id: 'exp-2', title: 'Designer', company: '' }] },
    }) as CV
    vi.spyOn(api, 'getCV').mockResolvedValue(envelope(source))
    const commit = vi.spyOn(api, 'commitCV').mockResolvedValue(commitResult(source, 1))
    const { result } = renderHook(() => useCVStore('cv-1'))
    await waitFor(() => expect(result.current.draft).not.toBeNull())
    const proposal = applyChatOpsToDraft(result.current.draft!, [{ op: 'add', path: '/sections/experience/0/techStack', value: ['Go'], rationale: 'Add stack', grounding: { type: 'user_message', ref: 'Stack' } }])
    act(() => result.current.applyAIDraft(proposal, 'Add nested stack'))
    const manual = result.current.getDraft()!
    act(() => result.current.updateDraft({ cv: { ...manual.cv, sections: { ...manual.cv.sections, experience: [manual.cv.sections.experience[1]!, manual.cv.sections.experience[0]!] } }, layout: manual.layout }))
    await act(async () => result.current.saveDraft())
    expect(commit).toHaveBeenCalledWith('cv-1', expect.objectContaining({ sections: expect.objectContaining({ experience: [expect.objectContaining({ id: 'exp-2' }), expect.objectContaining({ id: 'exp-1', techStack: ['Go'] })] }) }), expect.anything(), 'ai', 'Add nested stack', 0)
  })

  it('follows an AI nested array add after an earlier item is removed', async () => {
    const source = CVSchema.parse({
      schemaVersion: 2, id: 'cv-1', title: 'CV', lastModified: '', language: 'vi',
      sections: { ...cv.sections, experience: [{ id: 'exp-1', title: 'Engineer', company: '' }, { id: 'exp-2', title: 'Designer', company: '', highlights: [] }] },
    }) as CV
    vi.spyOn(api, 'getCV').mockResolvedValue(envelope(source))
    const commit = vi.spyOn(api, 'commitCV').mockResolvedValue(commitResult(source, 1))
    const { result } = renderHook(() => useCVStore('cv-1'))
    await waitFor(() => expect(result.current.draft).not.toBeNull())
    const proposal = applyChatOpsToDraft(result.current.draft!, [{ op: 'add', path: '/sections/experience/1/highlights/-', value: 'AI bullet', rationale: 'Add bullet', grounding: { type: 'user_message', ref: 'Bullet' } }])
    act(() => result.current.applyAIDraft(proposal, 'Add nested bullet'))
    const manual = result.current.getDraft()!
    act(() => result.current.updateDraft({ cv: { ...manual.cv, sections: { ...manual.cv.sections, experience: [manual.cv.sections.experience[1]!] } }, layout: manual.layout }))
    await act(async () => result.current.saveDraft())
    expect(commit).toHaveBeenCalledWith('cv-1', expect.objectContaining({ sections: expect.objectContaining({ experience: [expect.objectContaining({ id: 'exp-2', highlights: ['AI bullet'] })] }) }), expect.anything(), 'ai', 'Add nested bullet', 0)
  })

  it('clears string provenance when a baseline-containing value is restored', async () => {
    const source = CVSchema.parse({
      schemaVersion: 2, id: 'cv-1', title: 'CV', lastModified: '', language: 'vi',
      sections: { ...cv.sections, intro: { ...cv.sections.intro, summary: 'Senior Engineer' } },
    }) as CV
    vi.spyOn(api, 'getCV').mockResolvedValue(envelope(source))
    const commit = vi.spyOn(api, 'commitCV').mockResolvedValue(commitResult(source, 1))
    const { result } = renderHook(() => useCVStore('cv-1'))
    await waitFor(() => expect(result.current.draft).not.toBeNull())
    const proposal = applyChatOpsToDraft(result.current.draft!, [{ op: 'replace', path: '/sections/intro/summary', value: 'Engineer', rationale: 'Shorten summary', grounding: { type: 'user_message', ref: 'Summary' } }])
    act(() => result.current.applyAIDraft(proposal, 'Shorten summary'))
    act(() => result.current.updateDraft({ cv: { ...source, title: 'Manual title', sections: { ...source.sections, intro: { ...source.sections.intro, summary: 'Senior Engineer' } } }, layout }))
    await act(async () => result.current.saveDraft())
    expect(commit).toHaveBeenCalledWith('cv-1', expect.objectContaining({ title: 'Manual title' }), expect.anything(), 'user', undefined, 0)
  })

  it('preserves nested primitive replacement provenance after manual prepend', async () => {
    const source = CVSchema.parse({
      schemaVersion: 2, id: 'cv-1', title: 'CV', lastModified: '', language: 'vi',
      sections: { ...cv.sections, experience: [{ id: 'exp-1', title: 'Engineer', company: '', techStack: ['Go', 'React'] }] },
    }) as CV
    vi.spyOn(api, 'getCV').mockResolvedValue(envelope(source))
    const commit = vi.spyOn(api, 'commitCV').mockResolvedValue(commitResult(source, 1))
    const { result } = renderHook(() => useCVStore('cv-1'))
    await waitFor(() => expect(result.current.draft).not.toBeNull())
    const proposal = applyChatOpsToDraft(result.current.draft!, [{ op: 'replace', path: '/sections/experience/0/techStack/0', value: 'Rust', rationale: 'Update stack', grounding: { type: 'user_message', ref: 'Rust' } }])
    act(() => result.current.applyAIDraft(proposal, 'Update stack'))
    const manual = result.current.getDraft()!
    act(() => result.current.updateDraft({ cv: { ...manual.cv, sections: { ...manual.cv.sections, experience: [{ ...manual.cv.sections.experience[0]!, techStack: ['Manual', 'Rust', 'React'] }] } }, layout: manual.layout }))
    await act(async () => result.current.saveDraft())
    expect(commit).toHaveBeenCalledWith('cv-1', expect.objectContaining({ sections: expect.objectContaining({ experience: [expect.objectContaining({ techStack: ['Manual', 'Rust', 'React'] })] }) }), expect.anything(), 'ai', 'Update stack', 0)
  })

  it('clears nested primitive replacement provenance when the replacement is restored', async () => {
    const source = CVSchema.parse({
      schemaVersion: 2, id: 'cv-1', title: 'CV', lastModified: '', language: 'vi',
      sections: { ...cv.sections, experience: [{ id: 'exp-1', title: 'Engineer', company: '', techStack: ['Go', 'React'] }] },
    }) as CV
    vi.spyOn(api, 'getCV').mockResolvedValue(envelope(source))
    const commit = vi.spyOn(api, 'commitCV').mockResolvedValue(commitResult(source, 1))
    const { result } = renderHook(() => useCVStore('cv-1'))
    await waitFor(() => expect(result.current.draft).not.toBeNull())
    const proposal = applyChatOpsToDraft(result.current.draft!, [{ op: 'replace', path: '/sections/experience/0/techStack/0', value: 'Rust', rationale: 'Update stack', grounding: { type: 'user_message', ref: 'Rust' } }])
    act(() => result.current.applyAIDraft(proposal, 'Update stack'))
    const manual = result.current.getDraft()!
    act(() => result.current.updateDraft({ cv: { ...manual.cv, title: 'Manual save', sections: { ...manual.cv.sections, experience: [{ ...manual.cv.sections.experience[0]!, techStack: ['Go', 'React'] }] } }, layout: manual.layout }))
    await act(async () => result.current.saveDraft())
    expect(commit).toHaveBeenCalledWith('cv-1', expect.anything(), expect.anything(), 'user', undefined, 0)
  })

  it('preserves mixed reorder provenance when the replacement value is restored', async () => {
    const source = CVSchema.parse({
      schemaVersion: 2, id: 'cv-1', title: 'CV', lastModified: '', language: 'vi',
      sections: { ...cv.sections, experience: [{ id: 'exp-1', title: 'Engineer', company: '', techStack: ['Go', 'React'] }] },
    }) as CV
    vi.spyOn(api, 'getCV').mockResolvedValue(envelope(source))
    const commit = vi.spyOn(api, 'commitCV').mockResolvedValue(commitResult(source, 1))
    const { result } = renderHook(() => useCVStore('cv-1'))
    await waitFor(() => expect(result.current.draft).not.toBeNull())
    const proposal = applyChatOpsToDraft(result.current.draft!, [{ op: 'replace', path: '/sections/experience/0/techStack', value: ['React', 'Rust'], rationale: 'Reorder and update stack', grounding: { type: 'user_message', ref: 'Mixed stack' } }])
    act(() => result.current.applyAIDraft(proposal, 'Mixed stack'))
    const manual = result.current.getDraft()!
    act(() => result.current.updateDraft({ cv: { ...manual.cv, title: 'Manual follow-up', sections: { ...manual.cv.sections, experience: [{ ...manual.cv.sections.experience[0]!, techStack: ['React', 'Go'] }] } }, layout: manual.layout }))
    await act(async () => result.current.saveDraft())
    expect(commit).toHaveBeenCalledWith('cv-1', expect.objectContaining({ sections: expect.objectContaining({ experience: [expect.objectContaining({ techStack: ['React', 'Go'] })] }) }), expect.anything(), 'ai', 'Mixed stack', 0)
  })

  it('preserves mixed reorder provenance when the added value is removed', async () => {
    const source = CVSchema.parse({
      schemaVersion: 2, id: 'cv-1', title: 'CV', lastModified: '', language: 'vi',
      sections: { ...cv.sections, experience: [{ id: 'exp-1', title: 'Engineer', company: '', techStack: ['Go', 'React'] }] },
    }) as CV
    vi.spyOn(api, 'getCV').mockResolvedValue(envelope(source))
    const commit = vi.spyOn(api, 'commitCV').mockResolvedValue(commitResult(source, 1))
    const { result } = renderHook(() => useCVStore('cv-1'))
    await waitFor(() => expect(result.current.draft).not.toBeNull())
    const proposal = applyChatOpsToDraft(result.current.draft!, [{ op: 'replace', path: '/sections/experience/0/techStack', value: ['React', 'Go', 'Rust'], rationale: 'Reorder and add stack', grounding: { type: 'user_message', ref: 'Mixed add' } }])
    act(() => result.current.applyAIDraft(proposal, 'Mixed add'))
    const manual = result.current.getDraft()!
    act(() => result.current.updateDraft({ cv: { ...manual.cv, title: 'Manual follow-up', sections: { ...manual.cv.sections, experience: [{ ...manual.cv.sections.experience[0]!, techStack: ['React', 'Go'] }] } }, layout: manual.layout }))
    await act(async () => result.current.saveDraft())
    expect(commit).toHaveBeenCalledWith('cv-1', expect.objectContaining({ sections: expect.objectContaining({ experience: [expect.objectContaining({ techStack: ['React', 'Go'] })] }) }), expect.anything(), 'ai', 'Mixed add', 0)
  })

  it.each([
    ['leading', ['React', 'Vue']],
    ['middle', ['Go', 'Vue']],
  ])('clears primitive reorder provenance when %s removal is restored', async (_label, proposedStack) => {
    const source = CVSchema.parse({
      schemaVersion: 2, id: 'cv-1', title: 'CV', lastModified: '', language: 'vi',
      sections: { ...cv.sections, experience: [{ id: 'exp-1', title: 'Engineer', company: '', techStack: ['Go', 'React', 'Vue'] }] },
    }) as CV
    vi.spyOn(api, 'getCV').mockResolvedValue(envelope(source))
    const commit = vi.spyOn(api, 'commitCV').mockResolvedValue(commitResult(source, 1))
    const { result } = renderHook(() => useCVStore('cv-1'))
    await waitFor(() => expect(result.current.draft).not.toBeNull())
    const proposal = applyChatOpsToDraft(result.current.draft!, [{ op: 'replace', path: '/sections/experience/0/techStack', value: proposedStack, rationale: 'Remove stack entry', grounding: { type: 'user_message', ref: 'Remove' } }])
    act(() => result.current.applyAIDraft(proposal, 'Remove stack entry'))
    const manual = result.current.getDraft()!
    act(() => result.current.updateDraft({ cv: { ...manual.cv, title: 'Manual restore', sections: { ...manual.cv.sections, experience: [{ ...manual.cv.sections.experience[0]!, techStack: ['Go', 'React', 'Vue'] }] } }, layout: manual.layout }))
    await act(async () => result.current.saveDraft())
    expect(commit).toHaveBeenCalledWith('cv-1', expect.anything(), expect.anything(), 'user', undefined, 0)
  })

  it('keeps independent add/remove provenance for mixed primitive-array net growth', async () => {
    const source = CVSchema.parse({
      schemaVersion: 2, id: 'cv-1', title: 'CV', lastModified: '', language: 'vi',
      sections: { ...cv.sections, experience: [{ id: 'exp-1', title: 'Engineer', company: '', techStack: ['Go', 'React', 'Vue'] }] },
    }) as CV
    vi.spyOn(api, 'getCV').mockResolvedValue(envelope(source))
    const commit = vi.spyOn(api, 'commitCV').mockResolvedValue(commitResult(source, 1))
    const { result } = renderHook(() => useCVStore('cv-1'))
    await waitFor(() => expect(result.current.draft).not.toBeNull())
    const proposal = applyChatOpsToDraft(result.current.draft!, [{ op: 'replace', path: '/sections/experience/0/techStack', value: ['React', 'Rust', 'TypeScript', 'Python'], rationale: 'Refresh stack', grounding: { type: 'user_message', ref: 'Stack' } }])
    act(() => result.current.applyAIDraft(proposal, 'Refresh stack'))
    const manual = result.current.getDraft()!
    act(() => result.current.updateDraft({ cv: { ...manual.cv, title: 'Manual follow-up', sections: { ...manual.cv.sections, experience: [{ ...manual.cv.sections.experience[0]!, techStack: ['React'] }] } }, layout: manual.layout }))
    await act(async () => result.current.saveDraft())
    expect(commit).toHaveBeenCalledWith('cv-1', expect.anything(), expect.anything(), 'ai', 'Refresh stack', 0)
  })

  it('keeps independent add/remove provenance for mixed primitive-array net shrink', async () => {
    const source = CVSchema.parse({
      schemaVersion: 2, id: 'cv-1', title: 'CV', lastModified: '', language: 'vi',
      sections: { ...cv.sections, experience: [{ id: 'exp-1', title: 'Engineer', company: '', techStack: ['Go', 'React', 'Vue'] }] },
    }) as CV
    vi.spyOn(api, 'getCV').mockResolvedValue(envelope(source))
    const commit = vi.spyOn(api, 'commitCV').mockResolvedValue(commitResult(source, 1))
    const { result } = renderHook(() => useCVStore('cv-1'))
    await waitFor(() => expect(result.current.draft).not.toBeNull())
    const proposal = applyChatOpsToDraft(result.current.draft!, [{ op: 'replace', path: '/sections/experience/0/techStack', value: ['Rust', 'React'], rationale: 'Refresh stack', grounding: { type: 'user_message', ref: 'Stack' } }])
    act(() => result.current.applyAIDraft(proposal, 'Refresh stack'))
    const manual = result.current.getDraft()!
    act(() => result.current.updateDraft({ cv: { ...manual.cv, title: 'Manual follow-up', sections: { ...manual.cv.sections, experience: [{ ...manual.cv.sections.experience[0]!, techStack: ['Go', 'React', 'Vue', 'Rust'] }] } }, layout: manual.layout }))
    await act(async () => result.current.saveDraft())
    expect(commit).toHaveBeenCalledWith('cv-1', expect.anything(), expect.anything(), 'ai', 'Refresh stack', 0)
  })

  it('keeps mixed reorder provenance after only the replacement is removed', async () => {
    const source = CVSchema.parse({
      schemaVersion: 2, id: 'cv-1', title: 'CV', lastModified: '', language: 'vi',
      sections: { ...cv.sections, experience: [{ id: 'exp-1', title: 'Engineer', company: '', techStack: ['Go', 'React', 'Vue'] }] },
    }) as CV
    vi.spyOn(api, 'getCV').mockResolvedValue(envelope(source))
    const commit = vi.spyOn(api, 'commitCV').mockResolvedValue(commitResult(source, 1))
    const { result } = renderHook(() => useCVStore('cv-1'))
    await waitFor(() => expect(result.current.draft).not.toBeNull())
    const proposal = applyChatOpsToDraft(result.current.draft!, [{ op: 'replace', path: '/sections/experience/0/techStack', value: ['React', 'Go', 'Rust'], rationale: 'Reorder and replace stack', grounding: { type: 'user_message', ref: 'Mixed stack' } }])
    act(() => result.current.applyAIDraft(proposal, 'Mixed stack'))
    const manual = result.current.getDraft()!
    act(() => result.current.updateDraft({ cv: { ...manual.cv, title: 'Manual follow-up', sections: { ...manual.cv.sections, experience: [{ ...manual.cv.sections.experience[0]!, techStack: ['React', 'Go'] }] } }, layout: manual.layout }))
    await act(async () => result.current.saveDraft())
    expect(commit).toHaveBeenCalledWith('cv-1', expect.objectContaining({ sections: expect.objectContaining({ experience: [expect.objectContaining({ techStack: ['React', 'Go'] })] }) }), expect.anything(), 'ai', 'Mixed stack', 0)
  })

  it.each([
    ['exact mixed replacement restore', ['Go', 'React'], ['React', 'Rust'], ['Go', 'React'], 'user'],
    ['exact restore with one common marker', ['Go', 'React', 'Vue'], ['React', 'Rust', 'Python'], ['Go', 'React', 'Vue'], 'user'],
    ['baseline-ordered surviving subset', ['Go', 'React', 'Vue'], ['React', 'Go', 'Vue'], ['React', 'Vue'], 'user'],
    ['single surviving marker', ['Go', 'React', 'Vue'], ['React', 'Go', 'Vue'], ['React'], 'user'],
    ['duplicate reorder relation', ['Go', 'Go', 'React'], ['Go', 'React', 'Go'], ['React', 'Go'], 'ai'],
  ])('reconciles primitive order provenance by multiplicity and relation: %s', async (_label, baseline, proposed, manualStack, expectedSource) => {
    const source = CVSchema.parse({
      schemaVersion: 2, id: 'cv-1', title: 'CV', lastModified: '', language: 'vi',
      sections: { ...cv.sections, experience: [{ id: 'exp-1', title: 'Engineer', company: '', techStack: baseline }] },
    }) as CV
    vi.spyOn(api, 'getCV').mockResolvedValue(envelope(source))
    const commit = vi.spyOn(api, 'commitCV').mockResolvedValue(commitResult(source, 1))
    const { result } = renderHook(() => useCVStore('cv-1'))
    await waitFor(() => expect(result.current.draft).not.toBeNull())
    const proposal = applyChatOpsToDraft(result.current.draft!, [{ op: 'replace', path: '/sections/experience/0/techStack', value: proposed, rationale: 'Probe order', grounding: { type: 'user_message', ref: 'Order' } }])
    act(() => result.current.applyAIDraft(proposal, 'Probe order'))
    const manual = result.current.getDraft()!
    act(() => result.current.updateDraft({ cv: { ...manual.cv, title: 'Manual follow-up', sections: { ...manual.cv.sections, experience: [{ ...manual.cv.sections.experience[0]!, techStack: manualStack }] } }, layout: manual.layout }))
    await act(async () => result.current.saveDraft())
    expect(commit).toHaveBeenCalledWith('cv-1', expect.anything(), expect.anything(), expectedSource, expectedSource === 'ai' ? 'Probe order' : undefined, 0)
  })

  it('cancels consecutive unsaved scalar AI provenance against the committed baseline', async () => {
    vi.spyOn(api, 'getCV').mockResolvedValue(envelope())
    const commit = vi.spyOn(api, 'commitCV').mockResolvedValue(commitResult({ ...cv, title: 'Manual save' }, 1))
    const { result } = renderHook(() => useCVStore('cv-1'))
    await waitFor(() => expect(result.current.draft).not.toBeNull())
    act(() => result.current.applyAIDraft({ cv: { ...cv, title: 'AI A' }, layout }, 'AI A'))
    act(() => result.current.applyAIDraft({ cv: { ...cv, title: 'CV' }, layout }, 'AI restore'))
    act(() => result.current.updateDraft({ cv: { ...cv, title: 'Manual save' }, layout }))
    await act(async () => result.current.saveDraft())
    expect(commit).toHaveBeenCalledWith('cv-1', expect.objectContaining({ title: 'Manual save' }), layout, 'user', undefined, 0)
  })

  it('cancels consecutive unsaved primitive-array AI provenance against the committed baseline', async () => {
    const source = CVSchema.parse({
      schemaVersion: 2, id: 'cv-1', title: 'CV', lastModified: '', language: 'vi',
      sections: { ...cv.sections, experience: [{ id: 'exp-1', title: 'Engineer', company: '', techStack: ['Go'] }] },
    }) as CV
    vi.spyOn(api, 'getCV').mockResolvedValue(envelope(source))
    const commit = vi.spyOn(api, 'commitCV').mockResolvedValue(commitResult({ ...source, title: 'Manual save' }, 1))
    const { result } = renderHook(() => useCVStore('cv-1'))
    await waitFor(() => expect(result.current.draft).not.toBeNull())
    const add = applyChatOpsToDraft(result.current.draft!, [{ op: 'add', path: '/sections/experience/0/techStack/-', value: 'Rust', rationale: 'AI add', grounding: { type: 'user_message', ref: 'Rust' } }])
    act(() => result.current.applyAIDraft(add, 'AI add'))
    const remove = applyChatOpsToDraft(result.current.draft!, [{ op: 'remove', path: '/sections/experience/0/techStack/1', rationale: 'AI restore', grounding: { type: 'user_message', ref: 'Rust' } }])
    act(() => result.current.applyAIDraft(remove, 'AI restore'))
    const manual = result.current.getDraft()!
    act(() => result.current.updateDraft({ cv: { ...manual.cv, title: 'Manual save' }, layout: manual.layout }))
    await act(async () => result.current.saveDraft())
    expect(commit).toHaveBeenCalledWith('cv-1', expect.anything(), expect.anything(), 'user', undefined, 0)
  })

  it.each([
    ['duplicate reorder survives', ['A', 'A', 'B'], 'ai'],
    ['duplicate reorder exact restoration clears', ['A', 'B', 'A'], 'user'],
    ['duplicate reorder count reduction clears', ['A', 'B'], 'user'],
  ])('preserves duplicate occurrence order identity: %s', async (_label, manualStack, expectedSource) => {
    const source = CVSchema.parse({
      schemaVersion: 2, id: 'cv-1', title: 'CV', lastModified: '', language: 'vi',
      sections: { ...cv.sections, experience: [{ id: 'exp-1', title: 'Engineer', company: '', techStack: ['A', 'B', 'A'] }] },
    }) as CV
    vi.spyOn(api, 'getCV').mockResolvedValue(envelope(source))
    const commit = vi.spyOn(api, 'commitCV').mockResolvedValue(commitResult(source, 1))
    const { result } = renderHook(() => useCVStore('cv-1'))
    await waitFor(() => expect(result.current.draft).not.toBeNull())
    const proposal = applyChatOpsToDraft(result.current.draft!, [{ op: 'replace', path: '/sections/experience/0/techStack', value: ['A', 'A', 'B'], rationale: 'Reorder duplicate stack', grounding: { type: 'user_message', ref: 'Duplicate order' } }])
    act(() => result.current.applyAIDraft(proposal, 'Reorder duplicate'))
    const manual = result.current.getDraft()!
    act(() => result.current.updateDraft({ cv: { ...manual.cv, title: 'Manual follow-up', sections: { ...manual.cv.sections, experience: [{ ...manual.cv.sections.experience[0]!, techStack: manualStack }] } }, layout: manual.layout }))
    await act(async () => result.current.saveDraft())
    expect(commit).toHaveBeenCalledWith('cv-1', expect.anything(), expect.anything(), expectedSource, expectedSource === 'ai' ? 'Reorder duplicate' : undefined, 0)
  })

  it('cancels same-path AI content removal while preserving the manual residual', async () => {
    vi.spyOn(api, 'getCV').mockResolvedValue(envelope())
    const commit = vi.spyOn(api, 'commitCV').mockResolvedValue(commitResult({ ...cv, title: 'Manual' }, 1))
    const { result } = renderHook(() => useCVStore('cv-1'))
    await waitFor(() => expect(result.current.draft).not.toBeNull())
    act(() => result.current.applyAIDraft({ cv: { ...cv, title: 'AI fragment' }, layout }, 'AI A'))
    act(() => result.current.updateDraft({ cv: { ...cv, title: 'AI fragment Manual' }, layout }))
    act(() => result.current.applyAIDraft({ cv: { ...cv, title: 'Manual' }, layout }, 'AI B'))
    await act(async () => result.current.saveDraft())
    expect(commit).toHaveBeenCalledWith('cv-1', expect.objectContaining({ title: 'Manual' }), layout, 'user', undefined, 0)
  })

  it.each([
    ['baseline truncation', 'Senior Engineer', 'Engineer'],
    ['baseline blanking', 'CV', ''],
  ])('attributes standalone AI scalar removal: %s', async (_label, baselineTitle, proposedTitle) => {
    const source = CVSchema.parse({ ...cv, schemaVersion: 2, language: 'vi', title: baselineTitle }) as CV
    vi.spyOn(api, 'getCV').mockResolvedValue(envelope(source))
    const commit = vi.spyOn(api, 'commitCV').mockResolvedValue(commitResult(source, 1))
    const { result } = renderHook(() => useCVStore('cv-1'))
    await waitFor(() => expect(result.current.draft).not.toBeNull())
    act(() => result.current.applyAIDraft({ cv: { ...source, title: proposedTitle }, layout }, 'AI scalar removal'))
    await act(async () => result.current.saveDraft())
    expect(commit).toHaveBeenCalledWith('cv-1', expect.objectContaining({ title: proposedTitle }), layout, 'ai', 'AI scalar removal', 0)
  })
})
