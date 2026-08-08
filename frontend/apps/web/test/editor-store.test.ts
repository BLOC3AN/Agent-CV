import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { ProfileSchema, type Profile, type PatchOp } from '@hr/schema'
import { useEditor, applyLocal } from '../lib/editor-store'

/**
 * TC-24-01 · TC-24-03 · TC-54-01/02 · TDD A3
 * Store editor — nơi BR-24.1 (user và AI dùng chung đường ống patch) sống.
 */

const base = (): Profile =>
  ProfileSchema.parse({
    schemaVersion: 1,
    language: 'vi',
    basics: { name: 'Nguyễn Minh Khôi', headline: 'Backend Developer' },
    work: [{ org: 'ABC', role: 'Thực tập sinh', highlights: ['Làm đồ án', 'Viết test'] }],
    skills: [{ name: 'Node.js' }],
  })

const op = (o: Partial<PatchOp> & Pick<PatchOp, 'op' | 'path'>): PatchOp =>
  ({
    rationale: 'lý do đủ dài cho schema',
    grounding: { type: 'user_message', ref: 'test' },
    kbRefs: [],
    ...o,
  }) as PatchOp

const fetchMock = vi.fn()
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  useEditor.setState({
    profileId: null, cvId: null, profile: null, templateId: 'elegant', theme: {}, layout: {},
    undoStack: [], redoStack: [], pendingProposals: [],
    saveState: 'idle', lastError: null, activePath: null,
  })
})
afterEach(() => vi.unstubAllGlobals())

const okResponse = (profile: Profile) => ({
  ok: true,
  json: async () => ({ profile, rejected: [] }),
})

describe('applyLocal — patch tại chỗ, cùng thuật toán với server', () => {
  it('replace trong mảng lồng', () => {
    const p = applyLocal(base(), [op({ op: 'replace', path: '/work/0/highlights/0', value: 'MỚI' })])
    expect(p.work[0]!.highlights[0]).toBe('MỚI')
  })
  it('add cuối mảng bằng "-"', () => {
    const p = applyLocal(base(), [op({ op: 'add', path: '/skills/-', value: { name: 'Docker' } })])
    expect(p.skills).toHaveLength(2)
  })
  it('remove', () => {
    const p = applyLocal(base(), [op({ op: 'remove', path: '/work/0/highlights/1' })])
    expect(p.work[0]!.highlights).toHaveLength(1)
  })
  it('path sai thì trả nguyên bản, không crash', () => {
    const b = base()
    expect(applyLocal(b, [op({ op: 'replace', path: '/khong/co/dau', value: 1 })])).toEqual(b)
  })
  it('không đột biến đầu vào', () => {
    const b = base()
    const snap = JSON.stringify(b)
    applyLocal(b, [op({ op: 'replace', path: '/basics/headline', value: 'X' })])
    expect(JSON.stringify(b)).toBe(snap)
  })
})

describe('TC-24-01 — người sửa tay: optimistic', () => {
  it('UI đổi NGAY, không chờ mạng', async () => {
    const updated = { ...base(), basics: { ...base().basics, headline: 'Server' } }
    let resolveFetch!: (v: unknown) => void
    fetchMock.mockReturnValue(new Promise((r) => { resolveFetch = r }))

    useEditor.getState().init({ profileId: 'p1', cvId: 'c1', profile: base() })
    const promise = useEditor.getState().applyUser([
      op({ op: 'replace', path: '/basics/headline', value: 'Optimistic' }),
    ])

    // Chưa có phản hồi server, UI đã đổi
    expect(useEditor.getState().profile!.basics.headline).toBe('Optimistic')
    expect(useEditor.getState().saveState).toBe('saving')

    resolveFetch(okResponse(updated as Profile))
    await promise
    // Bản server làm chuẩn
    expect(useEditor.getState().profile!.basics.headline).toBe('Server')
    expect(useEditor.getState().saveState).toBe('idle')
  })
})

describe('TC-24-03 — lưu lỗi thì rollback', () => {
  it('trả về giá trị cũ và báo lỗi', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'Server hỏng' }) })
    useEditor.getState().init({ profileId: 'p1', cvId: 'c1', profile: base() })

    await useEditor.getState().applyUser([
      op({ op: 'replace', path: '/basics/headline', value: 'Sẽ bị rollback' }),
    ])

    const s = useEditor.getState()
    expect(s.profile!.basics.headline).toBe('Backend Developer')
    expect(s.saveState).toBe('error')
    expect(s.lastError).toContain('Server hỏng')
    // Không để rác lại trong lịch sử
    expect(s.undoStack).toHaveLength(0)
  })
})

describe('TDD A3 — đề xuất của AI KHÔNG BAO GIỜ optimistic', () => {
  it('Profile không đổi cho tới khi server xác nhận', async () => {
    const updated = { ...base(), basics: { ...base().basics, headline: 'AI viết' } }
    let resolveFetch!: (v: unknown) => void
    fetchMock.mockReturnValue(new Promise((r) => { resolveFetch = r }))

    useEditor.getState().init({ profileId: 'p1', cvId: 'c1', profile: base() })
    useEditor.getState().addProposal({
      id: 'prop1',
      summary: 'Viết lại headline',
      ops: [op({ op: 'replace', path: '/basics/headline', value: 'AI viết', grounding: { type: 'kb', ref: 'kb_1' } })],
    })

    const promise = useEditor.getState().applyAccepted('prop1', [0])
    // ĐANG chờ server — Profile PHẢI giữ nguyên
    expect(useEditor.getState().profile!.basics.headline).toBe('Backend Developer')

    resolveFetch(okResponse(updated as Profile))
    await promise
    expect(useEditor.getState().profile!.basics.headline).toBe('AI viết')
    // Đề xuất đã xử lý thì rời hàng chờ
    expect(useEditor.getState().pendingProposals).toHaveLength(0)
  })

  it('TC-53-05 — chỉ áp op được chọn', async () => {
    fetchMock.mockResolvedValue(okResponse(base()))
    useEditor.getState().init({ profileId: 'p1', cvId: 'c1', profile: base() })
    useEditor.getState().addProposal({
      id: 'p', summary: '3 thay đổi',
      ops: [
        op({ op: 'replace', path: '/basics/headline', value: 'A' }),
        op({ op: 'replace', path: '/work/0/role', value: 'B' }),
        op({ op: 'add', path: '/skills/-', value: { name: 'C' } }),
      ],
    })

    await useEditor.getState().applyAccepted('p', [0, 2]) // bỏ op giữa
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string) as {
      ops: PatchOp[]
      author: string
    }
    expect(body.ops).toHaveLength(2)
    expect(body.ops.map((o) => o.path)).toEqual(['/basics/headline', '/skills/-'])
    expect(body.author).toBe('ai')
  })

  it('bỏ qua đề xuất thì không gọi API', async () => {
    useEditor.getState().init({ profileId: 'p1', cvId: 'c1', profile: base() })
    useEditor.getState().addProposal({ id: 'x', summary: '', ops: [op({ op: 'replace', path: '/basics/headline', value: 'Z' })] })
    useEditor.getState().dismissProposal('x')
    expect(useEditor.getState().pendingProposals).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('TC-54-01/02 — undo ĐỒNG NHẤT cho user và AI', () => {
  it('undo thay đổi của user', async () => {
    fetchMock.mockResolvedValue(okResponse(base()))
    useEditor.getState().init({ profileId: 'p1', cvId: 'c1', profile: base() })

    fetchMock.mockResolvedValueOnce(
      okResponse({ ...base(), basics: { ...base().basics, headline: 'X' } } as Profile),
    )
    await useEditor.getState().applyUser([op({ op: 'replace', path: '/basics/headline', value: 'X' })])
    expect(useEditor.getState().undoStack).toHaveLength(1)

    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ profile: base() }) })
    await useEditor.getState().undo()
    expect(useEditor.getState().profile!.basics.headline).toBe('Backend Developer')
    expect(useEditor.getState().undoStack).toHaveLength(0)
  })

  it('undo thay đổi của AI — CÙNG stack, CÙNG hàm', async () => {
    useEditor.getState().init({ profileId: 'p1', cvId: 'c1', profile: base() })
    useEditor.getState().addProposal({ id: 'p', summary: '', ops: [op({ op: 'replace', path: '/basics/headline', value: 'AI' })] })

    fetchMock.mockResolvedValueOnce(
      okResponse({ ...base(), basics: { ...base().basics, headline: 'AI' } } as Profile),
    )
    await useEditor.getState().applyAccepted('p', [0])
    const stack = useEditor.getState().undoStack
    expect(stack).toHaveLength(1)
    expect(stack[0]!.source).toBe('ai')

    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ profile: base() }) })
    await useEditor.getState().undo()
    expect(useEditor.getState().profile!.basics.headline).toBe('Backend Developer')
  })

  it('không có gì để undo thì không gọi API', async () => {
    useEditor.getState().init({ profileId: 'p1', cvId: 'c1', profile: base() })
    await useEditor.getState().undo()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('TC-54-04 — giữ tối thiểu 50 bước', async () => {
    useEditor.getState().init({ profileId: 'p1', cvId: 'c1', profile: base() })
    fetchMock.mockResolvedValue(okResponse(base()))
    for (let i = 0; i < 60; i++) {
      await useEditor.getState().applyUser([op({ op: 'replace', path: '/basics/headline', value: `v${i}` })])
    }
    expect(useEditor.getState().undoStack.length).toBeGreaterThanOrEqual(50)
  })
})

describe('TC-31-01 — trình bày tách khỏi Profile (TDD A2, BR-31.2)', () => {
  it('đổi theme/layout/mẫu KHÔNG đụng tới Profile', () => {
    useEditor.getState().init({ profileId: 'p1', cvId: 'c1', profile: base() })
    const before = JSON.stringify(useEditor.getState().profile)

    useEditor.getState().setTheme({ accent: '#000000' })
    useEditor.getState().setLayout({ hidden: ['skills'] })
    useEditor.getState().setTemplate('minimal')

    expect(JSON.stringify(useEditor.getState().profile)).toBe(before)
    expect(useEditor.getState().theme.accent).toBe('#000000')
    expect(useEditor.getState().layout.hidden).toEqual(['skills'])
    expect(useEditor.getState().templateId).toBe('minimal')
  })

  it('trình bày lưu qua /api/cv/:id, KHÔNG qua /api/profiles', async () => {
    vi.useFakeTimers()
    useEditor.getState().init({ profileId: 'p1', cvId: 'c1', profile: base() })
    useEditor.getState().setTemplate('minimal')
    await vi.advanceTimersByTimeAsync(700)
    vi.useRealTimers()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/cv/c1')
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string) as { templateId: string }
    expect(body.templateId).toBe('minimal')
  })

  it('gộp nhiều thay đổi liên tiếp thành 1 request (kéo thanh trượt)', async () => {
    vi.useFakeTimers()
    useEditor.getState().init({ profileId: 'p1', cvId: 'c1', profile: base() })
    for (const v of [0.9, 0.95, 1.0, 1.05, 1.1]) useEditor.getState().setTheme({ scale: v })
    await vi.advanceTimersByTimeAsync(700)
    vi.useRealTimers()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string) as { theme: { scale: number } }
    expect(body.theme.scale).toBe(1.1)
  })
})
