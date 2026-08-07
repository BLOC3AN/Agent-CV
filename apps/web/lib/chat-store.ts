'use client'

import { create } from 'zustand'
import type { ClarifyRequest, PatchOp } from '@hr/schema'

/**
 * Phiên chat với trợ lý — sống ở đây, KHÔNG trong state của ChatPanel.
 *
 * ── Vì sao ──
 * `BuilderShell` chỉ mount một slide-over tại một thời điểm. Bấm "Lịch sử" là
 * ChatPanel bị unmount, và mọi `useState` trong nó biến mất. Người dùng mở lại
 * "Trợ lý" thì đoạn hội thoại trắng trơn — kể cả đề xuất họ chưa duyệt.
 *
 * Store ở mức module nên phiên chat sống đúng bằng vòng đời của TRANG: giữ qua
 * việc đổi tab, đổi drawer, điều hướng trong app; mất khi tải lại trang hoặc
 * đóng tab. Không đẩy xuống sessionStorage: lượt chat gắn với một phiên bản hồ
 * sơ cụ thể, khôi phục sau khi tải lại sẽ hiện những đề xuất soạn cho một hồ sơ
 * đã khác.
 *
 * `send` cũng nằm ở đây, không ở component: lượt chat mất 20–60s, và người dùng
 * hay bấm sang tab khác trong lúc chờ. Gọi trong component thì kết quả trả về
 * cho một component đã chết và bị bỏ.
 */

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  /** Việc làm tiếp được, kèm câu trả lời (UC-56 bước 5) */
  nextSteps?: string[]
}

export interface ChatProposal {
  proposalId: string
  summary: string
  ops: PatchOp[]
  rejected: { path: string; reason: string }[]
}

export interface ChatClarify {
  originalMessage: string
  request: ClarifyRequest
}

interface ChatState {
  /** Hồ sơ mà phiên này thuộc về — đổi hồ sơ là đổi hội thoại */
  profileId: string | null
  messages: ChatMessage[]
  input: string
  busy: boolean
  /** Bước model đang chạy — bắn về qua SSE trong lúc chờ */
  step: string | null
  proposal: ChatProposal | null
  clarify: ChatClarify | null

  /** Gắn store vào một hồ sơ; xoá hội thoại nếu là hồ sơ khác */
  attach: (profileId: string) => void
  setInput: (v: string) => void
  setProposal: (p: ChatProposal | null) => void
  setClarify: (c: ChatClarify | null) => void
  say: (m: ChatMessage) => void
  send: (text: string, answers?: { question: string; answer: string }[]) => Promise<void>
}

/**
 * Đọc luồng SSE, gọi `onStep` cho mỗi bước và trả về sự kiện `result` cuối.
 *
 * Viết tay thay vì dùng `EventSource` vì EventSource chỉ hỗ trợ GET, còn lượt
 * chat cần gửi hồ sơ và câu trả lời qua body.
 */
export async function readSse(
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

    // Mỗi sự kiện SSE kết thúc bằng một dòng trống
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''

    for (const part of parts) {
      const event = /^event:\s*(.+)$/m.exec(part)?.[1]?.trim()
      const raw = /^data:\s*([\s\S]+)$/m.exec(part)?.[1]
      if (!event || !raw) continue
      try {
        const data = JSON.parse(raw) as Record<string, unknown>
        if (event === 'step') onStep(String(data['label'] ?? ''))
        else if (event === 'result') result = data
      } catch {
        /* gói vỡ — bỏ qua, gói sau vẫn dùng được */
      }
    }
  }
  return result
}

export const useChat = create<ChatState>((set, get) => ({
  profileId: null,
  messages: [],
  input: '',
  busy: false,
  step: null,
  proposal: null,
  clarify: null,

  attach: (profileId) => {
    if (get().profileId === profileId) return
    set({
      profileId,
      messages: [],
      input: '',
      busy: false,
      step: null,
      proposal: null,
      clarify: null,
    })
  },

  setInput: (input) => set({ input }),
  setProposal: (proposal) => set({ proposal }),
  setClarify: (clarify) => set({ clarify }),
  say: (m) => set({ messages: [...get().messages, m] }),

  async send(text, answers = []) {
    const { profileId, busy } = get()
    if (!profileId || busy || !text.trim()) return

    set({
      busy: true,
      step: null,
      clarify: null,
      input: '',
      messages: [...get().messages, { role: 'user', content: text }],
    })

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId, message: text, answers }),
      })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

      const data = await readSse(res.body, (s) => set({ step: s }))
      if (!data) throw new Error('Máy chủ đóng kết nối giữa chừng')

      const parsed = data as {
        kind: string
        message?: string
        text?: string
        request?: ClarifyRequest
        proposalId?: string
        summary?: string
        ops?: PatchOp[]
        rejected?: { path: string; reason: string }[]
        nextSteps?: string[]
        error?: string
      }

      if (parsed.kind === 'clarify' && parsed.request) {
        set({
          messages: [...get().messages, { role: 'assistant', content: parsed.request.reason }],
          clarify: { originalMessage: text, request: parsed.request },
        })
      } else if (parsed.kind === 'patch' && parsed.proposalId) {
        set({
          messages: [...get().messages, { role: 'assistant', content: parsed.summary ?? '' }],
          proposal: {
            proposalId: parsed.proposalId,
            summary: parsed.summary ?? '',
            ops: parsed.ops ?? [],
            rejected: parsed.rejected ?? [],
          },
        })
      } else {
        set({
          messages: [
            ...get().messages,
            {
              role: 'assistant',
              content: parsed.text ?? parsed.message ?? 'Chưa xử lý được.',
              nextSteps: parsed.nextSteps ?? [],
            },
          ],
        })
      }
    } catch (e) {
      set({
        messages: [
          ...get().messages,
          { role: 'assistant', content: `Chưa gửi được: ${(e as Error).message}` },
        ],
      })
    } finally {
      set({ busy: false, step: null })
    }
  },
}))

/** Xoá phiên chat — dùng khi rời trang soạn CV */
export function resetChat(): void {
  useChat.setState({
    profileId: null,
    messages: [],
    input: '',
    busy: false,
    step: null,
    proposal: null,
    clarify: null,
  })
}
