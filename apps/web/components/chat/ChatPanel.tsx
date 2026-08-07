'use client'

import { useEffect } from 'react'
import type { Profile } from '@hr/schema'
import { PatchReviewModal } from './PatchReviewModal'
import { ClarifyForm } from './ClarifyForm'
import { useChat } from '@/lib/chat-store'

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
  const attach = useChat((s) => s.attach)
  const messages = useChat((s) => s.messages)
  const input = useChat((s) => s.input)
  const busy = useChat((s) => s.busy)
  const step = useChat((s) => s.step)
  const proposal = useChat((s) => s.proposal)
  const clarify = useChat((s) => s.clarify)
  const setInput = useChat((s) => s.setInput)
  const setProposal = useChat((s) => s.setProposal)
  const setClarify = useChat((s) => s.setClarify)
  const say = useChat((s) => s.say)
  const send = useChat((s) => s.send)

  useEffect(() => {
    attach(profileId)
  }, [attach, profileId])

  const suggestions = suggestionsFor(profile)

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
