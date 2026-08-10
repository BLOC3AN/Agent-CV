import { describe, expect, it, vi, afterEach } from 'vitest'
import { CVLayoutSchema, CVSchema, DEFAULT_CV_LAYOUT, type CV } from '@hr/schema'
import {
  ApiError,
  completeImport,
  commitCV,
  createCV,
  deleteAccount,
  deleteCV,
  getCV,
  getCVRevision,
  getImportReview,
  getJob,
  getSession,
  listCVs,
  listCVRevisions,
  patchProfile,
  requestLogin,
  readSSE,
  restoreCVRevision,
  saveCV,
  sendChat,
  settleChatProposal,
  uploadCV,
  verifyProfile,
} from '../src/lib/api.js'

function mockFetch(status: number, body: unknown, contentType = 'application/json') {
  const spy = vi.fn(async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': contentType },
    }),
  )
  vi.stubGlobal('fetch', spy)
  return spy
}

afterEach(() => {
  vi.unstubAllGlobals()
})

// CV v2 tối giản hợp lệ theo CVSchema — dùng .parse() để mọi default (design,
// activeSections, _meta...) được điền đúng như bộ chuyển đổi thật mong đợi,
// thay vì tự bịa một object rồi ép kiểu `as CV` che mất lỗi hình dạng.
const sampleCV: CV = CVSchema.parse({
  schemaVersion: 2,
  id: 'cv-1',
  title: 'CV mẫu',
  lastModified: '2026-08-10T00:00:00Z',
  language: 'vi',
  sections: { intro: { fullName: 'Nguyễn Văn A' } },
})

describe('listCVs', () => {
  it('trả về mảng items và gửi kèm cookie', async () => {
    const spy = mockFetch(200, {
      items: [{ id: 'cv-1', title: 'CV Backend', updatedAt: '2026-08-09T10:30:00Z' }],
    })

    const items = await listCVs()

    expect(items).toEqual([
      { id: 'cv-1', title: 'CV Backend', updatedAt: '2026-08-09T10:30:00Z' },
    ])
    expect((spy.mock.calls as any)[0]?.[0]).toBe('/api/cv')
    // Thiếu `credentials: 'include'` thì cookie phiên không được gửi và mọi
    // request đều 401 — hỏng theo kiểu trông như "chưa đăng nhập".
    expect((spy.mock.calls as any)[0]?.[1]).toMatchObject({ credentials: 'include' })
  })

  it('danh sách rỗng là mảng rỗng, không phải lỗi', async () => {
    mockFetch(200, { items: [] })
    await expect(listCVs()).resolves.toEqual([])
  })

  it('401 ném ApiError giữ nguyên mã trạng thái', async () => {
    mockFetch(401, { error: 'Chưa đăng nhập' })

    const err = await listCVs().catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ApiError)
    if (err instanceof ApiError) {
      expect(err.status).toBe(401)
      expect(err.message).toBe('Chưa đăng nhập')
    }
  })

  it('body không phải JSON vẫn ném ApiError chứ không vỡ', async () => {
    mockFetch(502, '<html>Bad Gateway</html>', 'text/html')

    const err = await listCVs().catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ApiError)
    if (err instanceof ApiError) {
      expect(err.status).toBe(502)
    }
  })
})

describe('deleteCV', () => {
  it('gọi DELETE đúng đường dẫn và mã hoá id', async () => {
    const spy = mockFetch(200, { ok: true })

    await deleteCV('cv/1')

    expect((spy.mock.calls as any)[0]?.[0]).toBe('/api/cv/cv%2F1')
    expect((spy.mock.calls as any)[0]?.[1]).toMatchObject({ method: 'DELETE' })
  })
})

describe('getSession', () => {
  it('đọc trạng thái đăng nhập', async () => {
    mockFetch(200, { authenticated: true, email: 'a@b.com' })
    await expect(getSession()).resolves.toEqual({ authenticated: true, email: 'a@b.com' })
  })

  it('mạng hỏng thì coi như chưa đăng nhập, không ném', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network') }))
    await expect(getSession()).resolves.toEqual({ authenticated: false })
  })
})

describe('requestLogin', () => {
  it('gửi email và trả devLink khi backend cung cấp', async () => {
    const spy = mockFetch(200, { ok: true, sent: false, devLink: 'http://x/verify?token=t' })

    const result = await requestLogin('  A@B.COM ')

    expect(JSON.parse((spy.mock.calls as any)[0]?.[1]?.body as string)).toEqual({ email: 'a@b.com' })
    expect(result.devLink).toBe('http://x/verify?token=t')
  })
})

// --- SP-3 Task 4: header opt-in v2 và các hàm CV/job/import mới ---

describe('X-CV-Schema header', () => {
  it('gắn X-CV-Schema: 2 vào MỌI lời gọi, không phải từng chỗ nhớ thì gắn', async () => {
    const seen: HeadersInit[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      seen.push(init?.headers ?? {})
      return new Response(JSON.stringify({ cv: { id: 'x' }, items: [] }), { status: 200 })
    }))

    await getCV('cv-1')
    await listCVs()

    expect(seen.length).toBe(2)
    for (const h of seen) {
      expect(new Headers(h).get('X-CV-Schema')).toBe('2')
    }
  })
})

describe('getCV', () => {
  it('gọi GET đúng đường dẫn và trả về cv từ body', async () => {
    const spy = mockFetch(200, { cv: { id: 'cv-1', profileSnapshot: sampleCV, schemaVersion: 2 } })

    const result = await getCV('cv-1')

    expect((spy.mock.calls as any)[0]?.[0]).toBe('/api/cv/cv-1')
    expect(result.schemaVersion).toBe(2)
    expect(result.profileSnapshot).toEqual(sampleCV)
  })

  it('409 V2_NOT_BACKFILLED thành thông điệp người đọc hiểu được', async () => {
    mockFetch(409, { error: '...', code: 'V2_NOT_BACKFILLED' })

    await expect(getCV('cv-1')).rejects.toThrow(/chưa có bản v2/i)
  })
})

describe('saveCV', () => {
  it('gửi duy nhất CV v2 tới PATCH /api/cv/:id', async () => {
    const spy = mockFetch(200, { ok: true })

    await saveCV('cv-1', sampleCV)

    expect((spy.mock.calls as any)[0]?.[0]).toBe('/api/cv/cv-1')
    expect((spy.mock.calls as any)[0]?.[1]).toMatchObject({ method: 'PATCH' })
    const body = JSON.parse((spy.mock.calls as any)[0]?.[1]?.body as string)
    expect(body.cv.schemaVersion).toBe(2)
    expect(body.profile).toBeUndefined()
  })

  it('400 SCHEMA_V2_INVALID thành thông điệp người đọc hiểu được', async () => {
    mockFetch(400, { error: '...', code: 'SCHEMA_V2_INVALID' })

    await expect(saveCV('cv-1', sampleCV)).rejects.toThrow(/định dạng/i)
  })
})

describe('CV revisions', () => {
  it('commits the CV and layout in one request', async () => {
    const spy = mockFetch(200, {
      cv: { id: 'cv-1', profileSnapshot: sampleCV, layout: { version: 1, nodes: [] } },
      revision: { id: 'revision-1', number: 1, cvId: 'cv-1', source: 'user', createdAt: '2026-08-10T00:00:00Z', profileSnapshot: sampleCV, layout: { version: 1, nodes: [] } },
    })
    const layout = CVLayoutSchema.parse(DEFAULT_CV_LAYOUT)

    const result = await commitCV('cv-1', sampleCV, layout, 'user', 'Save draft')

    expect((spy.mock.calls as any)[0]?.[0]).toBe('/api/cv/cv-1/commit')
    expect((spy.mock.calls as any)[0]?.[1]).toMatchObject({ method: 'POST' })
    expect(JSON.parse((spy.mock.calls as any)[0]?.[1]?.body as string)).toEqual({ cv: sampleCV, layout, source: 'user', message: 'Save draft', baseRevision: 0 })
    expect(result.revision.number).toBe(1)
  })

  it('uses the CV-scoped revision list, preview, and restore endpoints', async () => {
    const listSpy = mockFetch(200, { revisions: [{ id: 'revision-2', number: 2, cvId: 'cv-1', source: 'ai', createdAt: '2026-08-10T00:00:00Z' }] })
    await expect(listCVRevisions('cv-1')).resolves.toMatchObject([{ id: 'revision-2', number: 2 }])
    expect((listSpy.mock.calls as any)[0]?.[0]).toBe('/api/cv/cv-1/revisions')

    const previewSpy = mockFetch(200, { revision: { id: 'revision-2', number: 2, cvId: 'cv-1', source: 'ai', createdAt: '2026-08-10T00:00:00Z', profileSnapshot: sampleCV, layout: { version: 1, nodes: [] } }, before: { profileSnapshot: sampleCV, layout: { version: 1, nodes: [] } } })
    await expect(getCVRevision('cv-1', 'revision-2')).resolves.toMatchObject({ revision: { id: 'revision-2' }, before: { layout: { version: 1 } } })
    expect((previewSpy.mock.calls as any)[0]?.[0]).toBe('/api/cv/cv-1/revisions/revision-2')

    const restoreSpy = mockFetch(200, { cv: { id: 'cv-1', profileSnapshot: sampleCV, layout: { version: 1, nodes: [] } }, revision: { id: 'revision-3', number: 3, cvId: 'cv-1', source: 'restore', createdAt: '2026-08-10T00:00:00Z', profileSnapshot: sampleCV, layout: { version: 1, nodes: [] } } })
    await expect(restoreCVRevision('cv-1', 'revision-1', 2)).resolves.toMatchObject({ revision: { source: 'restore', number: 3 } })
    expect((restoreSpy.mock.calls as any)[0]?.[0]).toBe('/api/cv/cv-1/revisions/revision-1/restore')
    expect((restoreSpy.mock.calls as any)[0]?.[1]).toMatchObject({ method: 'POST' })
    expect(JSON.parse((restoreSpy.mock.calls as any)[0]?.[1]?.body as string)).toEqual({ baseRevision: 2 })
  })
})

describe('chat SSE', () => {
  it('đọc step và result từ các frame SSE bị chia nhỏ', async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: step\ndata: {"label":"Đang hiểu"}\n\n'))
        controller.enqueue(encoder.encode('event: result\ndata: {"kind":"reply","text":"Xin chào"}\n\n'))
        controller.close()
      },
    })
    const steps: string[] = []
    await expect(readSSE(stream, (label) => steps.push(label))).resolves.toEqual({ kind: 'reply', text: 'Xin chào' })
    expect(steps).toEqual(['Đang hiểu'])
  })

  it('gửi câu trả lời clarify cùng profileId và schema v2', async () => {
    const spy = vi.fn(async (..._args: Parameters<typeof fetch>) => new Response('event: result\ndata: {"kind":"clarify","request":{"reason":"Cần số liệu","targetPath":null,"questions":[]}}\n\n', { status: 200 }))
    vi.stubGlobal('fetch', spy)
    await expect(sendChat('profile-1', 'Thêm số liệu', [{ question: 'Có số liệu không?', answer: 'Không có' }])).resolves.toMatchObject({ kind: 'clarify' })
    const init = spy.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(init.body as string)).toMatchObject({ profileId: 'profile-1', answers: [{ answer: 'Không có' }] })
    expect(new Headers(init.headers).get('X-CV-Schema')).toBe('2')
  })
})

describe('settleChatProposal', () => {
  it('returns selected operations without a persisted profile', async () => {
    const spy = mockFetch(200, {
      applied: 1,
      status: 'accepted',
      selectedOps: [{ op: 'replace', path: '/sections/intro/fullName', value: 'New', rationale: 'Rõ hơn', grounding: { type: 'profile', ref: 'cv-1' } }],
      accepted: [0],
      rejected: [],
    })

    await expect(settleChatProposal('proposal/1', 'profile-1', [0])).resolves.toEqual(expect.objectContaining({
      applied: 1,
      status: 'accepted',
      selectedOps: expect.any(Array),
      accepted: [0],
      rejected: [],
    }))
    expect((spy.mock.calls as any)[0]?.[0]).toBe('/api/chat/proposals/proposal%2F1')
    expect(JSON.parse((spy.mock.calls as any)[0]?.[1]?.body as string)).toEqual({ profileId: 'profile-1', accept: [0] })
  })
})

describe('createCV', () => {
  it('gọi POST /api/cv với thông tin cơ bản', async () => {
    const spy = mockFetch(201, { cvId: 'cv-2', profileId: 'p-2' })

    const result = await createCV({ name: 'Trần Thị B', language: 'vi' })

    expect((spy.mock.calls as any)[0]?.[0]).toBe('/api/cv')
    expect((spy.mock.calls as any)[0]?.[1]).toMatchObject({ method: 'POST' })
    expect(result).toEqual({ cvId: 'cv-2', profileId: 'p-2' })
  })
})

describe('uploadCV', () => {
  it('gửi file dạng multipart tới POST /api/uploads/cv, không tự set content-type', async () => {
    const spy = mockFetch(202, { jobId: 'job-1', queued: true, uploadId: 'up-1' })
    const file = new File([new Uint8Array([1, 2, 3])], 'cv.pdf', { type: 'application/pdf' })

    const result = await uploadCV(file)

    expect((spy.mock.calls as any)[0]?.[0]).toBe('/api/uploads/cv')
    const init = (spy.mock.calls as any)[0]?.[1] as RequestInit
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
    // Trình duyệt tự sinh boundary cho multipart; ép content-type thủ công ở
    // đây là hỏng request vì thiếu boundary.
    expect(new Headers(init.headers).has('content-type')).toBe(false)
    expect(result).toEqual({ jobId: 'job-1', queued: true, uploadId: 'up-1' })
  })
})

describe('getJob', () => {
  it('gọi GET /api/jobs/:id', async () => {
    const spy = mockFetch(200, { id: 'job-1', kind: 'parse_cv', status: 'done', createdAt: '2026-08-10T00:00:00Z' })

    const job = await getJob('job-1')

    expect((spy.mock.calls as any)[0]?.[0]).toBe('/api/jobs/job-1')
    expect(job.status).toBe('done')
  })
})

describe('getImportReview', () => {
  it('gọi GET /api/imports/:id', async () => {
    const spy = mockFetch(200, { ready: false, status: 'processing' })

    const review = await getImportReview('job-1')

    expect((spy.mock.calls as any)[0]?.[0]).toBe('/api/imports/job-1')
    expect(review.ready).toBe(false)
  })
})

describe('patchProfile', () => {
  it('gửi ops dạng MẢNG THẬT (không phải chuỗi JSON) tới PATCH /api/profiles/:id', async () => {
    // `Ops` phía Go là `json.RawMessage` — nếu client gói `ops` thành chuỗi
    // (`JSON.stringify(ops)` rồi lại `JSON.stringify` một lần nữa ở body),
    // `json.Unmarshal(body.Ops, &ops)` nhận một chuỗi thay vì mảng và ném lỗi
    // kiểu, route trả 400 ngay cả khi ops hợp lệ.
    const spy = mockFetch(200, { profile: { schemaVersion: 1 }, revisionId: 1, applied: 1, rejected: [] })

    await patchProfile('profile-1', [{ op: 'add', path: '/sections/intro/fullName', value: 'Nguyễn Văn A' }])

    expect((spy.mock.calls as any)[0]?.[0]).toBe('/api/profiles/profile-1')
    expect((spy.mock.calls as any)[0]?.[1]).toMatchObject({ method: 'PATCH' })
    const body = JSON.parse((spy.mock.calls as any)[0]?.[1]?.body as string)
    expect(Array.isArray(body.ops)).toBe(true)
    expect(body.ops).toEqual([{ op: 'add', path: '/sections/intro/fullName', value: 'Nguyễn Văn A' }])
    expect(body.author).toBe('user')
  })
})

describe('verifyProfile', () => {
  it('gọi POST /api/profiles/:id/verify kèm danh sách path', async () => {
    const spy = mockFetch(200, { profile: { schemaVersion: 1 }, progress: { complete: true } })

    const result = await verifyProfile('profile-1', ['/sections/intro', '/sections/education/0'])

    expect((spy.mock.calls as any)[0]?.[0]).toBe('/api/profiles/profile-1/verify')
    expect((spy.mock.calls as any)[0]?.[1]).toMatchObject({ method: 'POST' })
    const body = JSON.parse((spy.mock.calls as any)[0]?.[1]?.body as string)
    expect(body).toEqual({ paths: ['/sections/intro', '/sections/education/0'], verified: true })
    expect(result.progress.complete).toBe(true)
  })
})

describe('completeImport', () => {
  it('gọi POST /api/imports/:id/complete', async () => {
    const spy = mockFetch(200, { cvId: 'cv-3', created: true })

    const result = await completeImport('job-1')

    expect((spy.mock.calls as any)[0]?.[0]).toBe('/api/imports/job-1/complete')
    expect((spy.mock.calls as any)[0]?.[1]).toMatchObject({ method: 'POST' })
    expect(result).toEqual({ cvId: 'cv-3', created: true })
  })
})

describe('deleteAccount', () => {
  it('gọi DELETE /api/account kèm email xác nhận', async () => {
    const spy = mockFetch(200, { ok: true })

    await deleteAccount('a@b.com')

    expect((spy.mock.calls as any)[0]?.[0]).toBe('/api/account')
    expect((spy.mock.calls as any)[0]?.[1]).toMatchObject({ method: 'DELETE' })
    expect(JSON.parse((spy.mock.calls as any)[0]?.[1]?.body as string)).toEqual({ confirmEmail: 'a@b.com' })
  })
})
