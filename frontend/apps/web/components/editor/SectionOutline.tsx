'use client'

import { ALL_SECTIONS, sectionTitle, type SectionId } from '@hr/templates'
import { useEditor } from '@/lib/editor-store'
import type { Profile } from '@hr/schema'

/**
 * Mục lục + sắp xếp + bật/tắt section (FRONTEND.md §3.1, §3.3).
 *
 * Kéo thả và bật/tắt đều sinh ra thay đổi `layout` của CVDocument, KHÔNG đụng
 * tới Profile — dữ liệu và cách trình bày tách rời (TDD A2, BR-31.2).
 *
 * Di chuyển bằng phím (TC-A11Y-02): mỗi mục có nút ▲▼, không bắt buộc kéo thả.
 */

function countItems(profile: Profile | null, id: SectionId): number {
  if (!profile) return 0
  switch (id) {
    case 'introduce': return profile.basics.introduce ? 1 : 0
    case 'work': return profile.work.length
    case 'projects': return profile.projects.length
    case 'education': return profile.education.length
    case 'skills': return profile.skills.length
    case 'activities': return profile.activities.length
    case 'certifications': return profile.certifications.length
    case 'languages': return profile.languages.length
  }
}

/** Dấu hiệu trạng thái — FRONTEND.md §3.3 */
function statusOf(
  profile: Profile | null,
  id: SectionId,
): { mark: string; label: string; tone: string } | null {
  if (!profile) return null
  // ⚪ có nội dung AI sinh chưa xác nhận
  const hasUnverified = Object.entries(profile._meta.verified).some(
    ([p, v]) => v === false && p.startsWith(`/${id}`),
  )
  if (hasUnverified) {
    return { mark: '⚪', label: 'Có nội dung AI viết, bạn chưa xác nhận', tone: 'text-ink-muted' }
  }
  return null
}

export function SectionOutline() {
  const profile = useEditor((s) => s.profile)
  const layout = useEditor((s) => s.layout)
  const setLayout = useEditor((s) => s.setLayout)
  const activePath = useEditor((s) => s.activePath)

  const lang = profile?.language ?? 'vi'
  const order = (layout.order ?? ALL_SECTIONS) as SectionId[]
  const hidden = new Set((layout.hidden ?? []) as SectionId[])

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length) return
    const next = [...order]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item!)
    setLayout({ order: next })
  }

  const toggle = (id: SectionId) => {
    const next = hidden.has(id)
      ? [...hidden].filter((x) => x !== id)
      : [...hidden, id]
    setLayout({ hidden: next })
  }

  return (
    <nav aria-label="Mục lục CV" className="builder-section-outline flex flex-col gap-0.5 text-sm">
      <h2 className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
        Các mục
      </h2>

      {order.map((id, i) => {
        const n = countItems(profile, id)
        const off = hidden.has(id)
        const st = statusOf(profile, id)
        const isActive = activePath?.startsWith(`/${id}`) ?? false

        return (
          <div
            key={id}
            className={`group flex items-center gap-1 rounded-md px-2 py-1.5 ${
              isActive ? 'bg-brand-subtle' : 'hover:bg-canvas'
            }`}
          >
            <span className={`flex-1 truncate ${off ? 'text-ink-subtle line-through' : ''}`}>
              {sectionTitle(id, lang)}
              {n > 0 && <span className="ml-1.5 text-xs text-ink-subtle">{n}</span>}
              {st && (
                <span className={`ml-1 ${st.tone}`} title={st.label} aria-label={st.label}>
                  {st.mark}
                </span>
              )}
            </span>

            <span className="flex opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
              <button
                type="button"
                onClick={() => move(i, i - 1)}
                disabled={i === 0}
                aria-label={`Chuyển ${sectionTitle(id, lang)} lên trên`}
                className="rounded px-1 text-ink-muted hover:bg-canvas disabled:opacity-30"
              >
                ▲
              </button>
              <button
                type="button"
                onClick={() => move(i, i + 1)}
                disabled={i === order.length - 1}
                aria-label={`Chuyển ${sectionTitle(id, lang)} xuống dưới`}
                className="rounded px-1 text-ink-muted hover:bg-canvas disabled:opacity-30"
              >
                ▼
              </button>
              <button
                type="button"
                onClick={() => toggle(id)}
                aria-label={off ? `Hiện ${sectionTitle(id, lang)}` : `Ẩn ${sectionTitle(id, lang)}`}
                aria-pressed={off}
                className="rounded px-1 text-ink-muted hover:bg-canvas"
              >
                {off ? '☐' : '☑'}
              </button>
            </span>
          </div>
        )
      })}
    </nav>
  )
}
