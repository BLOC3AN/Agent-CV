// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useCVStore } from '../src/lib/cv-store.js'
import * as api from '../src/lib/api.js'
import type { CV } from '../src/types.js'

const cv = { id: 'cv-1', title: 'CV', lastModified: '', sections: { intro: { fullName: 'A', title: '', email: '', phone: '', location: '', summary: '' }, experience: [], projects: [], education: [], skills: [], activities: [], certifications: [], languages: [] }, design: { template: 'modern', accentColor: '#000', font: 'Roboto', fontSize: 14, spacing: 'normal' }, activeSections: { intro: true, experience: true, projects: true, education: true, skills: true, activities: true, certifications: true, languages: true } } as CV

afterEach(() => vi.restoreAllMocks())

describe('useCVStore', () => {
  it('loads a real CV and debounces five edits into one save', async () => {
    vi.spyOn(api, 'getCV').mockResolvedValue({ profileSnapshot: cv } as never)
    const save = vi.spyOn(api, 'saveCV').mockResolvedValue(undefined)
    const { result } = renderHook(() => useCVStore('cv-1'))
    await waitFor(() => expect(result.current.cv).toEqual(cv))

    await act(async () => {
      for (let i = 0; i < 5; i++) result.current.update({ ...cv, title: `CV ${i}` })
      await new Promise((resolve) => setTimeout(resolve, 600))
    })
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('cv-1', expect.objectContaining({ title: 'CV 4' }))
  })

  it('keeps the edited value when saving fails', async () => {
    vi.spyOn(api, 'getCV').mockResolvedValue({ profileSnapshot: cv } as never)
    vi.spyOn(api, 'saveCV').mockRejectedValue(new api.ApiError(500, 'Lỗi lưu'))
    const { result } = renderHook(() => useCVStore('cv-1'))
    await waitFor(() => expect(result.current.cv).toEqual(cv))
    act(() => result.current.update({ ...cv, title: 'Nội dung đang gõ' }))
    await waitFor(() => expect(result.current.status).toBe('error'), { timeout: 1000 })
    expect(result.current.cv?.title).toBe('Nội dung đang gõ')
  })
})
