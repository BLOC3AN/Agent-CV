// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useCVStore } from '../src/lib/cv-store.js'
import * as api from '../src/lib/api.js'
import type { CV, CVLayout } from '../src/types.js'

const cv = {
  id: 'cv-1',
  title: 'CV',
  lastModified: '',
  sections: { intro: { fullName: 'A', title: '', email: '', phone: '', location: '', summary: '' }, experience: [], projects: [], education: [], skills: [], activities: [], certifications: [], languages: [] },
  design: { template: 'modern', accentColor: '#000', font: 'Roboto', fontSize: 14, spacing: 'normal' },
  activeSections: { intro: true, experience: true, projects: true, education: true, skills: true, activities: true, certifications: true, languages: true },
} as CV

const layout: CVLayout = { version: 1, nodes: [{ id: 'header', type: 'header', visible: true }] }

function envelope(profileSnapshot = cv, savedLayout = layout) {
  return { id: 'cv-1', profileId: 'profile-1', layout: savedLayout, profileSnapshot } as never
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
    const commit = vi.spyOn(api, 'commitCV').mockResolvedValue({ cv: envelope(updated) } as never)
    const { result } = renderHook(() => useCVStore('cv-1'))
    await waitFor(() => expect(result.current.draft?.cv).toEqual(cv))
    act(() => result.current.updateDraft({ cv: updated, layout }))

    await act(async () => result.current.saveDraft())

    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith('cv-1', updated, layout, 'user', undefined)
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

    pending.resolve({ cv: envelope({ ...cv, title: 'Một lần' }) })
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
    pending.resolve({ cv: envelope({ ...cv, title: 'Bản đầu' }) })
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
    pending.resolve({ cv: envelope({ ...cv, title: 'Không được bỏ' }) })
    await act(async () => { await save })
    expect(result.current.dirty).toBe(false)
  })
})
