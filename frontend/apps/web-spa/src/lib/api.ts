/**
 * Nơi DUY NHẤT trong SPA biết đường dẫn HTTP.
 *
 * Màn hình gọi hàm ở đây, không tự dựng URL. Nhờ vậy khi backend đổi đường
 * dẫn, chỗ phải sửa là một file — và khi có ai quên `credentials: 'include'`,
 * lỗi đó không thể lặp lại ở mười chỗ khác nhau.
 */

import type { CV, CVLayout } from '@hr/schema'

export class ApiError extends Error {
  readonly status: number
  /**
   * Mã lỗi của máy chủ, giữ nguyên để giao diện dịch được.
   *
   * Trước đây `request()` dùng mã để tra một bảng câu chữ TIẾNG VIỆT ngay tại
   * đây rồi vứt mã đi — nên mọi thông báo lỗi kẹt lại tiếng Việt kể cả khi
   * người dùng đã chuyển sang tiếng Anh. Bảng dịch nay nằm ở
   * `lib/error-messages.ts`, tầng có `t`.
   */
  readonly code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

/**
 * Header schema đặt ở ĐÂY, một chỗ duy nhất, và `request()` ở dưới gắn nó vào
 * MỌI lời gọi.
 *
 * Rải ra từng lời gọi thì chỉ cần một chỗ quên là endpoint đó thiếu schema,
 * và giao diện nhận một hình dạng nó không biết đọc — lỗi hiện ra ở tận nơi
 * render, cách xa chỗ gây ra. `GET /api/cv` (danh sách) bỏ qua header này ở
 * phía server nên gắn cả vào đó không hại gì — đơn giản hơn là nhớ loại trừ.
 */
const SCHEMA_HEADER = { 'X-CV-Schema': '2' } as const

/**
 * Mã lỗi backend → thông điệp tiếng Việt hành động được.
 *
 * Test giả lập server cố tình gửi `error: '...'` (không mang nghĩa gì) kèm
 * `code`, đúng như một cổng lỗi/proxy có thể làm khi nó không biết dịch mã
 * lỗi nghiệp vụ. Client không được tin `error` là đã đủ tốt để hiển thị —
 * phải tự dịch theo `code` khi biết mã đó, để "409" không hiện ra thành
 * "Request failed" mù mờ.
 */

export interface CVSummary {
  id: string
  title: string
  /** ISO-8601 UTC, do backend sinh. Định dạng để hiển thị là việc của giao diện. */
  updatedAt: string
  /** Vắng mặt nghĩa là CV không gắn tin tuyển dụng nào. */
  jdTitle?: string
}

export interface Session {
  authenticated: boolean
  email?: string
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  // Header gắn tại đây bằng cách dựng lại Headers từ init.headers rồi ghi đè
  // lên trên: dùng `...init` cho mọi field khác của RequestInit (method,
  // body, ...) như cũ, nhưng field `headers` không được để spread tự ý đè —
  // nếu không, lời gọi nào tự truyền `headers` riêng (vd. content-type của
  // requestLogin) sẽ xoá mất X-CV-Schema thay vì cộng dồn.
  const headers = new Headers(init.headers)
  headers.set('X-CV-Schema', SCHEMA_HEADER['X-CV-Schema'])

  let res: Response
  try {
    res = await fetch(path, {
      // Cookie hr_session là HttpOnly — không có dòng này thì trình duyệt
      // không gửi nó, và mọi thứ trả về 401.
      credentials: 'include',
      ...init,
      headers,
    })
  } catch {
    throw new ApiError(0, 'Network unreachable', 'NETWORK_UNREACHABLE')
  }

  const text = await res.text()
  let body: unknown = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      // Cổng lỗi trả HTML, không phải JSON. Đừng để chi tiết đó thành lỗi cú pháp.
      body = null
    }
  }

  if (!res.ok) {
    const code =
      body && typeof body === 'object' && typeof (body as { code?: unknown }).code === 'string'
        ? (body as { code: string }).code
        : undefined
    const serverMessage =
      body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : undefined
    // Giữ nguyên văn của máy chủ làm chỗ lùi; giao diện ưu tiên dịch theo
    // `code` qua `lib/error-messages.ts`.
    throw new ApiError(res.status, serverMessage ?? 'Server error', code ?? 'SERVER_ERROR')
  }

  return body as T
}

export async function listCVs(): Promise<CVSummary[]> {
  const body = await request<{ items: CVSummary[] }>('/api/cv')
  return body.items ?? []
}

export async function deleteCV(id: string): Promise<void> {
  await request<unknown>(`/api/cv/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/**
 * Hình dạng response của `GET /api/cv/:id` — xem `getCV`/`cvRoute` phía Go
 * (backend/internal/api/server.go). `profileSnapshot` là tài liệu v2 đầy đủ
 * (đúng `CVSchema` của `@hr/schema`) vì mọi lời gọi ở đây đều mang
 * `X-CV-Schema: 2`; `schemaVersion` chỉ có mặt khi server biết trả v2, tức là
 * luôn luôn ở đây.
 */
export interface CVEnvelope {
  id: string
  profileId: string
  title: string
  templateId: string
  theme: unknown
  /** Legacy `{}` storage is normalized to the shared default by GET /api/cv/:id. */
  layout: CVLayout
  language: string
  updatedAt: string
  profileSnapshot: CV
  schemaVersion: 2
  /** Latest committed CV revision; zero means the legacy initialization state. */
  revisionNumber: number
}

export interface ChatOp {
  op: 'add' | 'replace' | 'remove'
  path: string
  value?: unknown
  rationale: string
  grounding: { type: string; ref: string }
  kbRefs?: string[]
}

export interface SettledChatProposal {
  applied: number
  status: 'accepted' | 'partial' | 'rejected'
  selectedOps: ChatOp[]
  accepted: number[]
  rejected: number[]
}

export interface ChatDraftContext {
  cvId: string
  draft: CV
  layout: CVLayout
  draftVersion: number
}

export interface ClarifyRequest {
  reason: string
  targetPath: string | null
  questions: { id: string; question: string; placeholder?: string }[]
}

export type ChatResult =
  | { kind: 'reply'; text: string }
  | { kind: 'clarify'; request: ClarifyRequest }
  | { kind: 'patch'; proposalId: string; summary: string; ops: ChatOp[]; rejected: { path: string; reason: string }[] }
  | { kind: 'error'; code?: string; message: string; detail?: string; requestId?: string }

export async function readSSE(
  body: ReadableStream<Uint8Array>,
  onStep: (label: string) => void,
): Promise<Record<string, unknown> | null> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result: Record<string, unknown> | null = null
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      const event = /^event:\s*(.+)$/m.exec(part)?.[1]?.trim()
      const raw = /^data:\s*([\s\S]+)$/m.exec(part)?.[1]
      if (!event || !raw) continue
      try {
        const data = JSON.parse(raw) as Record<string, unknown>
        if (event === 'step') onStep(String(data.label ?? ''))
        if (event === 'result') result = data
      } catch { /* ignore malformed frame */ }
    }
  }
  return result
}

export async function sendChat(
  profileId: string,
  message: string,
  answers: { question: string; answer: string }[] = [],
  modelRef = 'local.reasoner',
  hint?: string,
  signal?: AbortSignal,
  onStep: (label: string) => void = () => {},
  context?: ChatDraftContext,
  /** Ngôn ngữ giao diện — quyết định mô hình trả lời tiếng gì. */
  language?: 'vi' | 'en',
): Promise<ChatResult> {
  const headers = new Headers({ 'content-type': 'application/json', 'X-CV-Schema': '2' })
  const res = await fetch('/api/chat', {
    method: 'POST', credentials: 'include', signal, headers,
    body: JSON.stringify({ profileId, message, answers, modelRef, ...(language ? { language } : {}), ...(hint ? { hint } : {}), ...(context ? {
      cvId: context.cvId,
      draftToken: String(context.draftVersion),
      draft: context.draft,
      layout: context.layout,
    } : {}) }),
  })
  if (!res.ok) throw new ApiError(res.status, ((await res.json().catch(() => null)) as { error?: string })?.error ?? 'Send failed', 'SEND_FAILED')
  if (!res.body) throw new ApiError(0, 'Stream open failed', 'STREAM_OPEN_FAILED')
  const result = await readSSE(res.body, onStep)
  if (!result) throw new ApiError(0, 'Stream closed early', 'STREAM_CLOSED_EARLY')
  return result as unknown as ChatResult
}

export async function settleChatProposal(proposalId: string, profileId: string, contextOrAccept: Pick<ChatDraftContext, 'cvId' | 'draftVersion'> | number[], maybeAccept?: number[]): Promise<SettledChatProposal> {
  const legacy = Array.isArray(contextOrAccept)
  const accept = legacy ? contextOrAccept : (maybeAccept ?? [])
  const context = legacy ? undefined : contextOrAccept
  return request<SettledChatProposal>(`/api/chat/proposals/${encodeURIComponent(proposalId)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profileId, ...(context ? { cvId: context.cvId, draftToken: String(context.draftVersion) } : {}), accept }),
  })
}

export interface AnalyzeReport {
  ready: boolean
  overall?: number
  breakdown?: Record<string, number>
  matched?: unknown[]
  gaps?: { id: string; requirement: string; severity: string; reason: string; advice: string | null; kbRefs: string[] }[]
  missingAtsKeywords?: string[]
  degraded?: boolean
  degradedReason?: string | null
  advicePending?: number
  jd?: { id: string; title: string | null; seniority: string | null }
}

export async function startAnalyze(input: { cvId: string; jdText: string; language?: 'vi' | 'en' }) {
  return request<{ jobId: string; cvId: string; jdId: string; queued: boolean }>('/api/analyze', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
  })
}

export async function getAnalyze(cvId: string): Promise<AnalyzeReport> {
  return request<AnalyzeReport>(`/api/analyze/${encodeURIComponent(cvId)}`)
}

export interface Citation {
  chunkId: string
  text?: string
  authorName: string
  authorTitle?: string
  excerpt: string
}

export async function getCitations(chunkIds: string[]): Promise<Citation[]> {
  const body = await request<{ citations: Citation[] }>('/api/kb/citations', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chunkIds }),
  })
  return body.citations ?? []
}

export interface KBSource {
  id: string
  title: string
  authorName: string
  authorTitle: string
  language: 'vi' | 'en'
  status: 'draft' | 'active' | 'archived'
  version: number
  chunkCount: number
  canActivate: boolean
}

export async function listKBSources(): Promise<KBSource[]> {
  const body = await request<{ sources: KBSource[] }>('/api/kb')
  return body.sources ?? []
}

export async function updateKBSource(input: { sourceId: string; status?: KBSource['status']; authorName?: string; authorTitle?: string }): Promise<void> {
  await request('/api/kb', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })
}

export async function getCV(id: string): Promise<CVEnvelope> {
  const body = await request<{ cv: CVEnvelope }>(`/api/cv/${encodeURIComponent(id)}`)
  return body.cv
}

/** Lưu trực tiếp tài liệu CV v2 duy nhất của production. */
export async function saveCV(id: string, cv: CV): Promise<void> {
  await request<unknown>(`/api/cv/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cv }),
  })
}

export type CVRevisionSource = 'user' | 'ai' | 'restore'

export interface CVRevisionSnapshot {
  profileSnapshot: CV
  layout: CVLayout
}

export interface CVRevision extends CVRevisionSnapshot {
  id: string
  number: number
  cvId: string
  source: CVRevisionSource
  message?: string
  parentRevisionId?: string
  createdAt: string
}

export interface CVRevisionSummary {
  id: string
  number: number
  cvId: string
  source: CVRevisionSource
  message?: string
  parentRevisionId?: string
  createdAt: string
}

export interface CVCommitResult {
  cv: CVEnvelope
  revision: CVRevision
}

export async function commitCV(
  id: string,
  cv: CV,
  layout: CVLayout,
  source: Extract<CVRevisionSource, 'user' | 'ai'>,
  message?: string,
  baseRevision = 0,
): Promise<CVCommitResult> {
  return request<CVCommitResult>(`/api/cv/${encodeURIComponent(id)}/commit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cv, layout, source, ...(message ? { message } : {}), baseRevision }),
  })
}

export async function listCVRevisions(id: string): Promise<CVRevisionSummary[]> {
  const body = await request<{ revisions: CVRevisionSummary[] }>(`/api/cv/${encodeURIComponent(id)}/revisions`)
  return body.revisions ?? []
}

export async function getCVRevision(id: string, revisionId: string): Promise<{ revision: CVRevision; before?: CVRevisionSnapshot }> {
  return request<{ revision: CVRevision; before?: CVRevisionSnapshot }>(
    `/api/cv/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revisionId)}`,
  )
}

export async function restoreCVRevision(id: string, revisionId: string, baseRevision: number): Promise<CVCommitResult> {
  return request<CVCommitResult>(`/api/cv/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revisionId)}/restore`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ baseRevision }),
  })
}

export interface CreateCVInput {
  name: string
  headline?: string
  email?: string
  phone?: string
  language?: 'vi' | 'en'
}

export interface CreateCVResult {
  cvId: string
  profileId: string
}

export async function createCV(input: CreateCVInput): Promise<CreateCVResult> {
  return request<CreateCVResult>('/api/cv', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}

/**
 * Không bao giờ ném. Câu hỏi "tôi là ai" được đặt ở mỗi lần tải trang; để nó
 * ném thì backend chết sẽ thành màn hình trắng thay vì màn hình đăng nhập.
 */
export async function getSession(): Promise<Session> {
  try {
    return await request<Session>('/api/auth/session')
  } catch {
    return { authenticated: false }
  }
}

export async function requestLogin(email: string): Promise<{ ok: boolean; devLink?: string }> {
  return request<{ ok: boolean; devLink?: string }>('/api/auth/request', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: email.trim().toLowerCase() }),
  })
}

export async function logout(): Promise<void> {
  await request<unknown>('/api/auth/logout', { method: 'POST' })
}

export interface UploadCVResult {
  jobId: string
  queued: boolean
  uploadId: string
}

/**
 * `POST /api/uploads/cv` nhận multipart, không phải JSON — body là
 * `FormData` nên KHÔNG được tự set header `content-type`: trình duyệt cần
 * tự sinh giá trị đó kèm boundary, ép cứng nó ở đây làm hỏng request.
 */
export async function uploadCV(file: File, uploadId?: string): Promise<UploadCVResult> {
  const form = new FormData()
  form.append('file', file)
  if (uploadId) form.append('uploadId', uploadId)
  return request<UploadCVResult>('/api/uploads/cv', { method: 'POST', body: form })
}

/** Hình dạng khớp `type Job struct` phía Go (server.go). */
export interface Job {
  id: string
  kind: string
  status: string
  createdAt: string
  result?: Record<string, unknown>
  error?: unknown
}

export async function getJob(id: string): Promise<Job> {
  return request<Job>(`/api/jobs/${encodeURIComponent(id)}`)
}

/**
 * Hình dạng response của `GET /api/imports/:id` (importStatus, server.go).
 * Job chưa xong thì chỉ có `status`/`error`; xong rồi mới có hồ sơ v2 để
 * duyệt (`items`/`progress`) — hai nhánh phân biệt bằng `ready`.
 */
export interface ImportReviewPending {
  ready: false
  status: string
  error?: { code: string; message: string } | null
}

export interface ImportReviewReady {
  ready: true
  status: string
  profileId: string
  /** Hồ sơ v2 thô — đây là màn duyệt trước khi tạo CV document. */
  profile: unknown
  items: Array<{ kind: string; path: string; title: string }>
  progress: { done: number; total: number; complete: boolean; pending: string[] }
  quality: { level: string; warning: boolean; reasons: string[]; engine?: unknown; pages: number }
  sections?: unknown
}

export type ImportReview = ImportReviewPending | ImportReviewReady

export async function getImportReview(jobId: string): Promise<ImportReview> {
  return request<ImportReview>(`/api/imports/${encodeURIComponent(jobId)}`)
}

/**
 * Một thao tác JSON Patch RFC 6902 thô — KHÔNG phải `PatchOp` của `@hr/schema`
 * (`packages/schema/src/patch.ts`), thứ đó là đề xuất CỦA AI và bắt buộc kèm
 * `rationale`/`grounding` để user duyệt trước khi áp. Ở đây là user tự tay sửa
 * một field trên chính màn rà soát của họ — không có gì để "duyệt" thêm một
 * lớp nữa — nên chỉ cần hình dạng tối thiểu mà `applyJSONPatch` (server.go,
 * dùng thư viện `evanphx/json-patch`) đọc được.
 */
export interface JSONPatchOp {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test'
  path: string
  value?: unknown
  from?: string
}

export interface PatchProfileResult {
  profile: unknown
  revisionId: number
  applied: number
  rejected: unknown[]
}

/**
 * `PATCH /api/profiles/:id` (patchProfile, server.go dòng ~577) — đích duy
 * nhất nơi một sửa tại chỗ ở màn rà soát (`ImportReviewRoute`, Task 7) thực sự
 * được lưu. Dùng `op: 'add'` thay vì `'replace'` cho field vốn có thể vắng mặt
 * (vd. `headline` model không trích ra được): theo RFC 6902, `add` tại một
 * field object đã tồn tại là ghi đè, còn `replace` đòi field đó PHẢI có sẵn từ
 * trước — model bỏ sót field nào thì patch đó vỡ ngay tại field cần sửa nhất.
 */
export async function patchProfile(
  profileId: string,
  ops: JSONPatchOp[],
  author: 'user' | 'ai' | 'import' = 'user',
): Promise<PatchProfileResult> {
  return request<PatchProfileResult>(`/api/profiles/${encodeURIComponent(profileId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ops, author }),
  })
}

export interface VerifyProfileResult {
  profile: unknown
  /**
   * KHÔNG phải tiến độ rà soát — server.go dòng ~876 trả nguyên văn
   * `{"complete": verified}`, với `verified` là chính cờ `verified` gửi lên
   * trong body request (mặc định `true`), không phải một phép tính lại trên
   * toàn bộ `_meta.verified`. Gọi `verifyProfile(id, paths, true)` thì trường
   * này LUÔN là `{complete: true}` dù còn 10 mục khác chưa xác nhận — tên
   * field trùng với `ImportReview.progress` (đúng hình dạng
   * `{done,total,complete,pending}`) nhưng KHÔNG cùng ý nghĩa.
   *
   * Review vòng 1 (Minor 2): giữ field này vì server thật sự trả về nó, nhưng
   * đừng dùng nó để mở khoá bất cứ nút nào — `ImportReviewRoute` cố tình bỏ
   * qua field này và gọi lại `getImportReview` để lấy `progress` thật.
   */
  progress: { complete: boolean }
}

/**
 * `POST /api/profiles/:id/verify` (verifyProfile, server.go dòng ~819) — nơi
 * `_meta.verified` thật sự được ghi. Đây là hành động "Đúng rồi" của UC-22:
 * xác nhận CẢ MỤC (`/sections/intro`, `/sections/experience/0`, …), không phải từng field lẻ.
 */
export async function verifyProfile(
  profileId: string,
  paths: string[],
  verified = true,
): Promise<VerifyProfileResult> {
  return request<VerifyProfileResult>(`/api/profiles/${encodeURIComponent(profileId)}/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ paths, verified }),
  })
}

export interface CompleteImportResult {
  cvId: string
  created: boolean
}

/**
 * `POST /api/imports/:id/complete` không đọc body (importComplete, server.go
 * dòng ~1359) — job đã có sẵn profileId từ lúc parse xong, không cần SPA gửi
 * lại CV. Brief gốc viết `completeImport(jobId, cv)`; bỏ tham số `cv` vì
 * route thật không dùng tới nó, và tự bịa ra một tham số route không đọc chỉ
 * tạo ảo giác về một hợp đồng không tồn tại.
 */
export async function completeImport(jobId: string): Promise<CompleteImportResult> {
  return request<CompleteImportResult>(`/api/imports/${encodeURIComponent(jobId)}/complete`, {
    method: 'POST',
  })
}

/**
 * `DELETE /api/account` đòi `confirmEmail` trong body để khớp lại email đang
 * đăng nhập (deleteAccount, server.go) — đây là chốt chặn cuối trước một thao
 * tác không thể hoàn tác, không phải tham số tuỳ chọn. Brief gốc viết
 * `deleteAccount()` không tham số; route thật từ chối request thiếu
 * `confirmEmail` bằng 400, nên hàm không tham số sẽ luôn thất bại.
 */
export async function deleteAccount(confirmEmail: string): Promise<void> {
  await request<unknown>('/api/account', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirmEmail }),
  })
}
