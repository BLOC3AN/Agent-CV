'use client'

import { useState } from 'react'
import type { PatchOp, Profile } from '@hr/schema'
import { PatchReviewModal, type ProposalData } from './PatchReviewModal'
import { ClarifyForm, type ClarifyData } from './ClarifyForm'

/**
 * Khung chat với trợ lý — UC-51, FRONTEND §4.
 *
 * Người dùng gõ "làm gọn mục kinh nghiệm" → trợ lý hỏi lại nếu thiếu thông tin
 * → đề xuất thay đổi → user duyệt từng mục → áp dụng.
 *
 * Trợ lý KHÔNG BAO GIỜ tự sửa hồ sơ (BR-53.1).
 */

interface Message {
  role: 'user' | 'assistant'
  content: string
  /**
   * Việc làm tiếp được, kèm theo câu trả lời (UC-56 bước 5).
   *
   * Hiện thành NÚT chứ không phải chữ thường: mỗi mục vốn là một câu gõ lại
   * được vào ô chat, in ra dạng chữ thì người dùng phải tự gõ lại y hệt.
   */
  nextSteps?: string[]
}

/**
 * Đọc luồng SSE, gọi `onStep` cho mỗi bước và trả về sự kiện `result` cuối.
 *
 * Viết tay thay vì dùng `EventSource` vì EventSource chỉ hỗ trợ GET, còn lượt
 * chat cần gửi hồ sơ và câu trả lời qua body.
 */
async function readSse(
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

/**
 * Gợi ý dựng từ HỒ SƠ THẬT, không phải danh sách cố định.
 *
 * Danh sách cứng mời người dùng vào ngõ cụt: chip "Thêm số liệu cho dự án đầu
 * tiên" hiện ra trên một CV KHÔNG CÓ mục dự án nào, trợ lý bịa đường dẫn
 * `/projects/0/...`, mọi op bị loại, và người dùng nhận một câu lỗi trách
 * ngược lại họ. Đo thật trên CV có 1 kinh nghiệm, 0 dự án.
 */
function suggestionsFor(p: Profile): string[] {
  const out: string[] = []
  if (p.work.length > 0) out.push('Làm gọn mục kinh nghiệm')
  if (p.projects.length > 0) out.push('Thêm số liệu cho dự án đầu tiên')
  if (p.basics.summary) out.push('Viết lại phần giới thiệu cho gọn hơn')
  if (p.work.some((w) => w.highlights.length > 0)) {
    out.push('Viết lại các gạch đầu dòng bằng động từ mạnh')
  }
  if (p.skills.length > 8) out.push('Rút gọn danh sách kỹ năng')

  // CV quá sơ sài thì không gợi ý sửa — gợi ý BỔ SUNG
  if (out.length === 0) {
    return ['CV của tôi còn thiếu gì?', 'Nên thêm mục nào cho CV mạnh hơn?']
  }
  return out.slice(0, 4)
}

interface Props {
  profileId: string
  profile: Profile
  onProfileChange: (p: Profile) => void
}

export function ChatPanel({ profileId, profile, onProfileChange }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  /** Bước model đang chạy — bắn về qua SSE trong lúc chờ */
  const [step, setStep] = useState<string | null>(null)
  const [proposal, setProposal] = useState<ProposalData | null>(null)
  const [clarify, setClarify] = useState<ClarifyData | null>(null)
  const suggestions = suggestionsFor(profile)

  const send = async (
    text: string,
    answers: { question: string; answer: string }[] = [],
  ): Promise<void> => {
    if (!text.trim()) return
    setBusy(true)
    setStep(null)
    setClarify(null)
    setMessages((m) => [...m, { role: 'user', content: text }])
    setInput('')

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId, message: text, answers }),
      })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

      // Đọc SSE thủ công thay vì EventSource: EventSource chỉ làm được GET,
      // mà lượt chat cần gửi cả hồ sơ và câu trả lời qua body.
      const data = await readSse(res.body, (s) => setStep(s))
      if (!data) throw new Error('Máy chủ đóng kết nối giữa chừng')

      const parsed = data as {
        kind: string
        message?: string
        text?: string
        request?: ClarifyData['request']
        proposalId?: string
        summary?: string
        ops?: PatchOp[]
        rejected?: { path: string; reason: string }[]
        nextSteps?: string[]
        error?: string
      }

      if (parsed.kind === 'clarify' && parsed.request) {
        setMessages((m) => [...m, { role: 'assistant', content: parsed.request!.reason }])
        setClarify({ originalMessage: text, request: parsed.request })
      } else if (parsed.kind === 'patch' && parsed.proposalId) {
        setMessages((m) => [...m, { role: 'assistant', content: parsed.summary ?? '' }])
        setProposal({
          proposalId: parsed.proposalId,
          summary: parsed.summary ?? '',
          ops: parsed.ops ?? [],
          rejected: parsed.rejected ?? [],
        })
      } else {
        setMessages((m) => [
          ...m,
          {
            role: 'assistant',
            content: parsed.text ?? parsed.message ?? 'Chưa xử lý được.',
            nextSteps: parsed.nextSteps ?? [],
          },
        ])
      }
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: `Chưa gửi được: ${(e as Error).message}` },
      ])
    } finally {
      setBusy(false)
      setStep(null)
    }
  }

  return (
    <section aria-label="Trợ lý CV" className="flex h-full flex-col">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Trợ lý CV
      </h2>

      <div className="min-h-[200px] flex-1 space-y-3 overflow-y-auto rounded-lg border border-neutral-200 p-3 dark:border-neutral-700">
        {messages.length === 0 && (
          <div className="text-sm text-neutral-500">
            <p>Bạn muốn sửa gì trong CV? Ví dụ:</p>
            <ul className="mt-2 space-y-1">
              {suggestions.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => void send(s)}
                    className="text-left underline underline-offset-2 hover:text-sky-600"
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            className={[
              'max-w-[90%] rounded-lg px-3 py-2 text-sm',
              m.role === 'user'
                ? 'ml-auto bg-sky-600 text-white'
                : 'bg-neutral-100 dark:bg-neutral-800',
            ].join(' ')}
          >
            {m.content}

            {(m.nextSteps?.length ?? 0) > 0 && (
              <ul className="mt-2 space-y-1 border-t border-neutral-300 pt-2 dark:border-neutral-600">
                {m.nextSteps!.map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void send(s)}
                      className="text-left text-sky-700 underline underline-offset-2 hover:text-sky-900 disabled:opacity-40 dark:text-sky-400"
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}

        {busy && (
          <div
            role="status"
            aria-live="polite"
            className="flex max-w-[90%] items-center gap-2 rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-500 dark:bg-neutral-800"
          >
            <span
              aria-hidden
              className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-neutral-300 border-t-sky-600"
            />
            {/*
              Nói RÕ đang làm gì. "Đang suy nghĩ…" suốt nửa phút khiến người
              dùng không biết hệ thống còn sống hay đã treo, và nhiều người sẽ
              bấm lại — thêm một lượt vào hàng đợi vốn đã chậm.
            */}
            <span>{step ?? 'Đang kết nối'}…</span>
          </div>
        )}

        {clarify && (
          <ClarifyForm
            data={clarify}
            onSubmit={(answers) => void send(clarify.originalMessage, answers)}
            onSkip={() => setClarify(null)}
          />
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void send(input)
        }}
        className="mt-3 flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
          placeholder="Bạn muốn sửa gì?"
          aria-label="Tin nhắn cho trợ lý"
          className="flex-1 rounded border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Gửi
        </button>
      </form>

      {proposal && (
        <PatchReviewModal
          data={proposal}
          profile={profile}
          profileId={profileId}
          onApplied={(p, applied) => {
            setProposal(null)
            onProfileChange(p)
            setMessages((m) => [
              ...m,
              { role: 'assistant', content: `Đã áp dụng ${applied} thay đổi.` },
            ])
          }}
          onDismiss={() => {
            setProposal(null)
            setMessages((m) => [...m, { role: 'assistant', content: 'Đã bỏ qua các đề xuất.' }])
          }}
        />
      )}
    </section>
  )
}
