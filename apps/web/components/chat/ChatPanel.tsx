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
}

const SUGGESTIONS = [
  'Làm gọn mục kinh nghiệm',
  'Thêm số liệu cho dự án đầu tiên',
  'Viết lại phần giới thiệu cho gọn hơn',
]

interface Props {
  profileId: string
  profile: Profile
  onProfileChange: (p: Profile) => void
}

export function ChatPanel({ profileId, profile, onProfileChange }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [proposal, setProposal] = useState<ProposalData | null>(null)
  const [clarify, setClarify] = useState<ClarifyData | null>(null)

  const send = async (
    text: string,
    answers: { question: string; answer: string }[] = [],
  ): Promise<void> => {
    if (!text.trim()) return
    setBusy(true)
    setClarify(null)
    setMessages((m) => [...m, { role: 'user', content: text }])
    setInput('')

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId, message: text, answers }),
      })
      const data = (await res.json()) as {
        kind: string
        message?: string
        text?: string
        request?: ClarifyData['request']
        proposalId?: string
        summary?: string
        ops?: PatchOp[]
        rejected?: { path: string; reason: string }[]
        error?: string
      }

      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)

      if (data.kind === 'clarify' && data.request) {
        setMessages((m) => [...m, { role: 'assistant', content: data.request!.reason }])
        setClarify({ originalMessage: text, request: data.request })
      } else if (data.kind === 'patch' && data.proposalId) {
        setMessages((m) => [...m, { role: 'assistant', content: data.summary ?? '' }])
        setProposal({
          proposalId: data.proposalId,
          summary: data.summary ?? '',
          ops: data.ops ?? [],
          rejected: data.rejected ?? [],
        })
      } else {
        setMessages((m) => [
          ...m,
          { role: 'assistant', content: data.text ?? data.message ?? 'Chưa xử lý được.' },
        ])
      }
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: `Chưa gửi được: ${(e as Error).message}` },
      ])
    } finally {
      setBusy(false)
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
              {SUGGESTIONS.map((s) => (
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
          </div>
        ))}

        {busy && (
          <div className="max-w-[90%] rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-500 dark:bg-neutral-800">
            Đang suy nghĩ…
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
