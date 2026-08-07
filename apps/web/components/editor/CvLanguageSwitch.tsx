'use client'

import type { Language } from '@hr/schema'
import { useEditor } from '@/lib/editor-store'

/**
 * Công tắc ngôn ngữ CV — FRONTEND §9.6.
 *
 * ── Đây là trục nào ──
 * Có BA trục ngôn ngữ độc lập: giao diện, CV, và JD. Công tắc này đổi trục CV
 * và KHÔNG đụng tới hai trục kia. Gộp chúng lại là sai: một người Việt hoàn
 * toàn có thể muốn giao diện tiếng Việt mà CV tiếng Anh để nộp công ty nước
 * ngoài — đó là trường hợp phổ biến nhất, không phải ngoại lệ.
 *
 * ── Vì sao phải nói "không dịch nội dung" ──
 * Đổi `profile.language` làm tiêu đề mục do template sinh đi theo
 * (`Ngoại ngữ` ↔ `Languages`), nhưng chữ người dùng tự viết giữ nguyên. Không
 * nói rõ thì họ bấm EN, thấy nội dung vẫn tiếng Việt, và kết luận là hỏng.
 *
 * ── Vì sao đi qua applyUser ──
 * FRONTEND §9.2: thao tác của người dùng cũng là JSON Patch, đi CÙNG đường ống
 * với thay đổi từ AI. Nhờ vậy Hoàn tác hoạt động đồng nhất — đổi nhầm ngôn ngữ
 * thì Ctrl+Z lùi lại được như mọi thay đổi khác, không cần cơ chế riêng.
 */

const OPTIONS: { value: Language; label: string }[] = [
  { value: 'vi', label: 'Tiếng Việt' },
  { value: 'en', label: 'English' },
]

export function CvLanguageSwitch() {
  const profile = useEditor((s) => s.profile)
  const applyUser = useEditor((s) => s.applyUser)
  const current: Language = profile?.language ?? 'vi'

  const choose = (next: Language): void => {
    // Bấm lại chính ngôn ngữ đang chọn: không phát op. Một op không đổi gì vẫn
    // tạo một mốc trong lịch sử phiên bản, và người dùng sẽ phải Hoàn tác một
    // thao tác chẳng làm gì.
    if (next === current) return
    void applyUser([
      {
        op: 'replace',
        path: '/language',
        value: next,
        rationale: 'Người dùng đổi ngôn ngữ CV',
        grounding: { type: 'user_message', ref: 'language-switch' },
        kbRefs: [],
      },
    ])
  }

  return (
    <div className="flex items-center gap-2">
      <div
        role="group"
        aria-label="Ngôn ngữ CV"
        className="inline-flex overflow-hidden rounded-md border border-border"
      >
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => choose(o.value)}
            aria-pressed={o.value === current}
            className={
              o.value === current
                ? 'bg-brand px-2.5 py-1 text-[12px] font-medium text-white'
                : 'bg-surface px-2.5 py-1 text-[12px] text-ink-muted hover:text-ink'
            }
          >
            {o.label}
          </button>
        ))}
      </div>
      <span className="text-[12px] text-ink-subtle">
        Đổi tiêu đề mục — không dịch nội dung bạn đã viết
      </span>
    </div>
  )
}
