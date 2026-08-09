'use client'

import { useEffect } from 'react'
import type { Profile } from '@hr/schema'
import { PatchReviewModal } from './PatchReviewModal'
import { ClarifyForm } from './ClarifyForm'
import { RichText } from './RichText'
import { CHAT_MODELS, useChat, type ChatHint } from '@/lib/chat-store'

let mermaidSequence = 0

function useMermaidDiagrams(key: string) {
  useEffect(() => {
    let active = true
    const nodes = document.querySelectorAll<HTMLElement>('[data-mermaid-source]')
    if (nodes.length === 0) return
    void import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: document.documentElement.classList.contains('dark') ? 'dark' : 'default',
      })
      return Promise.all(
        Array.from(nodes).map(async (node) => {
          try {
            const { svg } = await mermaid.render(`chat-mermaid-${++mermaidSequence}`, node.dataset.mermaidSource ?? '')
            if (active) node.innerHTML = svg
          } catch {
            if (active) node.textContent = 'Mermaid không hợp lệ. Kiểm tra lại cú pháp biểu đồ.'
          }
        }),
      )
    })
    return () => {
      active = false
    }
  }, [key])
}

/**
 * Khung chat với trợ lý — UC-51, FRONTEND §4.
 *
 * Người dùng gõ "làm gọn mục kinh nghiệm" → trợ lý hỏi lại nếu thiếu thông tin
 * → đề xuất thay đổi → user duyệt từng mục → áp dụng.
 *
 * Trợ lý KHÔNG BAO GIỜ tự sửa hồ sơ (BR-53.1).
 *
 * Trạng thái hội thoại nằm ở `@/lib/chat-store`, KHÔNG ở đây: component này bị
 * unmount mỗi lần người dùng chuyển sang tab Lịch sử, và state trong component
 * sẽ mất theo (xem chú thích trong chat-store.ts).
 */

/**
 * Gợi ý dựng từ HỒ SƠ THẬT, không phải danh sách cố định.
 *
 * Danh sách cứng mời người dùng vào ngõ cụt: chip "Thêm số liệu cho dự án đầu
 * tiên" hiện ra trên một CV KHÔNG CÓ mục dự án nào, trợ lý bịa đường dẫn
 * `/projects/0/...`, mọi op bị loại, và người dùng nhận một câu lỗi trách
 * ngược lại họ. Đo thật trên CV có 1 kinh nghiệm, 0 dự án.
 */
function suggestionsFor(p: Profile): { text: string; hint?: ChatHint }[] {
  const out: { text: string; hint?: ChatHint }[] = []
  if (p.work.length > 0) out.push({ text: 'Làm gọn mục kinh nghiệm', hint: 'tighten_bullets' })
  if (p.work.some((w) => w.highlights.length > 0)) {
    out.push({ text: 'Làm giàu nội dung các điểm nổi bật', hint: 'enrich_content' })
  }
  if (p.projects.length > 0) out.push({ text: 'Thêm số liệu cho dự án đầu tiên' })
  if (p.basics.introduce) out.push({ text: 'Viết lại phần giới thiệu cho gọn hơn', hint: 'rewrite_introduce' })
  if (p.work.some((w) => w.highlights.length > 0)) {
    out.push({ text: 'Viết lại các gạch đầu dòng bằng động từ mạnh', hint: 'strong_verbs' })
  }
  if (p.skills.length > 8) out.push({ text: 'Rút gọn danh sách kỹ năng' })

  // CV quá sơ sài thì không gợi ý sửa — gợi ý BỔ SUNG
  if (out.length === 0) {
    return [{ text: 'CV của tôi còn thiếu gì?' }, { text: 'Nên thêm mục nào cho CV mạnh hơn?' }]
  }
  return out.slice(0, 4)
}

interface Props {
  profileId: string
  profile: Profile
  onProfileChange: (p: Profile) => void
}

export function ChatPanel({ profileId, profile, onProfileChange }: Props) {
  const attach = useChat((s) => s.attach)
  const messages = useChat((s) => s.messages)
  const input = useChat((s) => s.input)
  const busy = useChat((s) => s.busy)
  const step = useChat((s) => s.step)
  const proposal = useChat((s) => s.proposal)
  const clarify = useChat((s) => s.clarify)
  const modelRef = useChat((s) => s.modelRef)
  const stop = useChat((s) => s.stop)
  const setInput = useChat((s) => s.setInput)
  const setProposal = useChat((s) => s.setProposal)
  const setClarify = useChat((s) => s.setClarify)
  const setModelRef = useChat((s) => s.setModelRef)
  const say = useChat((s) => s.say)
  const send = useChat((s) => s.send)
  const appliedProfile = useChat((s) => s.appliedProfile)
  const consumeAppliedProfile = useChat((s) => s.consumeAppliedProfile)

  useMermaidDiagrams(messages.map((m) => m.content).join('\n'))

  useEffect(() => {
    attach(profileId)
  }, [attach, profileId])

  useEffect(() => {
    if (!appliedProfile) return
    onProfileChange(appliedProfile)
    consumeAppliedProfile()
  }, [appliedProfile, consumeAppliedProfile, onProfileChange])

  const suggestions = suggestionsFor(profile)

  return (
    <section aria-label="Trợ lý CV" className="flex h-full flex-col">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
        Trợ lý CV
      </h2>

      <label className="mb-3 flex items-center gap-2 text-sm text-ink-muted">
        <span>Model</span>
        <select
          aria-label="Chọn model"
          value={modelRef}
          disabled={busy}
          onChange={(e) => setModelRef(e.target.value as typeof modelRef)}
          className="rounded border border-border-strong bg-white px-2 py-1 text-sm text-ink"
        >
          {CHAT_MODELS.map((model) => (
            <option key={model.ref} value={model.ref}>
              {model.label}
            </option>
          ))}
        </select>
      </label>

      <div className="min-h-[200px] flex-1 space-y-3 overflow-y-auto rounded-lg border border-border p-3">
        {messages.length === 0 && (
          <div className="text-sm text-ink-muted">
            <p>Bạn muốn sửa gì trong CV? Ví dụ:</p>
            <ul className="mt-2 space-y-1">
              {suggestions.map((s) => (
                <li key={s.text}>
                  <button
                    type="button"
                  onClick={() => void send(s.text, [], s.hint)}
                    className="text-left underline underline-offset-2 hover:text-brand"
                  >
                    {s.text}
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
                ? 'chat-user ml-auto bg-brand text-white'
                : 'bg-canvas',
            ].join(' ')}
          >
            {m.role === 'assistant' ? <RichText content={m.content} /> : m.content}

            {(m.nextSteps?.length ?? 0) > 0 && (
              <ul className="mt-2 space-y-1 border-t border-border-strong pt-2">
                {m.nextSteps!.map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void send(s)}
                      className="text-left text-brand-ink underline underline-offset-2 hover:text-brand-ink disabled:opacity-40"
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
            className="flex max-w-[90%] items-center gap-2 rounded-lg bg-canvas px-3 py-2 text-sm text-ink-muted"
          >
            <span
              aria-hidden
              className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-border-strong border-t-brand"
            />
            {/*
              Nói RÕ đang làm gì. "Đang suy nghĩ…" suốt nửa phút khiến người
              dùng không biết hệ thống còn sống hay đã treo, và nhiều người sẽ
              bấm lại — thêm một lượt vào hàng đợi vốn đã chậm.
            */}
            <span>{step ?? 'Đang chuẩn bị'}…</span>
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
          className="flex-1 rounded border border-border-strong px-3 py-2 text-sm"
        />
        {busy ? (
          <button
            type="button"
            onClick={stop}
            className="rounded border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
          >
            Dừng
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="rounded bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            Gửi
          </button>
        )}
      </form>

      {proposal && (
        <PatchReviewModal
          data={proposal}
          profile={profile}
          profileId={profileId}
          onApplied={(p, applied) => {
            setProposal(null)
            onProfileChange(p)
            say({ role: 'assistant', content: `Đã áp dụng ${applied} thay đổi.` })
          }}
          onDismiss={() => {
            setProposal(null)
            say({ role: 'assistant', content: 'Đã bỏ qua các đề xuất.' })
          }}
        />
      )}
    </section>
  )
}
