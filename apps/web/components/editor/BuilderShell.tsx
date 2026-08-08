'use client'

import { useEffect, useState } from 'react'
import type { Profile } from '@hr/schema'
import { FieldProvider, getTemplate, type Layout, type Theme } from '@hr/templates'
import { useEditor } from '@/lib/editor-store'
import { editableRenderer } from './Editable'
import { CvLanguageSwitch } from './CvLanguageSwitch'
import { SectionOutline } from './SectionOutline'
import { UndoRedo, SaveStatus } from './UndoRedo'
import { ThemePicker } from './ThemePicker'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { VersionHistory } from './VersionHistory'
import { Sheet } from '@/components/ui'

/**
 * Khung màn hình soạn CV — FRONTEND.md §3.1.
 *
 * Bố cục 2 PANE, không phải 3: sinh viên VN phần lớn dùng laptop 1366×768,
 * ba pane cố định làm vùng xem CV còn ~500px, không đọc nổi (TC-CMP-01).
 *
 * Trợ lý và lịch sử phiên bản là SLIDE-OVER đè lên, không phải pane thứ ba —
 * chúng chỉ cần khi người dùng chủ động gọi, và khi đó họ đang đọc panel chứ
 * không đọc CV.
 */

interface Props {
  profileId: string
  cvId: string
  initialProfile: Profile
  templateId: string
  theme: Partial<Theme>
  layout: Partial<Layout>
  title: string
  initialDrawer?: Exclude<Drawer, null> | null
  focusPath?: string | null
}

type Drawer = 'chat' | 'history' | null

export function BuilderShell(props: Props) {
  const [drawer, setDrawer] = useState<Drawer>(props.initialDrawer ?? null)
  const init = useEditor((s) => s.init)
  const storeProfile = useEditor((s) => s.profile)
  const storeTheme = useEditor((s) => s.theme)
  const storeLayout = useEditor((s) => s.layout)
  const storeTemplateId = useEditor((s) => s.templateId)

  useEffect(() => {
    init({
      profileId: props.profileId,
      cvId: props.cvId,
      profile: props.initialProfile,
      templateId: props.templateId,
      theme: props.theme,
      layout: props.layout,
    })
  }, [init, props.profileId, props.cvId, props.initialProfile,
      props.templateId, props.theme, props.layout])

  useEffect(() => {
    if (props.initialDrawer) setDrawer(props.initialDrawer)
  }, [props.initialDrawer])

  useEffect(() => {
    if (!props.focusPath) return
    const timer = window.setTimeout(() => {
      const target = Array.from(document.querySelectorAll<HTMLElement>('[data-editable]')).find((el) => el.dataset.editable === props.focusPath)
      target?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      target?.focus({ preventScroll: true })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [props.focusPath, storeProfile])

  /*
   * Lúc server-render, store còn rỗng (init chạy trong useEffect, chỉ có ở
   * client). Nếu `return null` thì SSR ra trang trắng — Playwright, trình đọc
   * màn hình và người dùng không JS đều không thấy gì.
   *
   * Dùng props làm nguồn dự phòng: SSR render đầy đủ, sau khi hydrate thì store
   * tiếp quản. KHÔNG ghi store trong lúc render vì store là module-level —
   * ghi lúc server-render sẽ rò state giữa các request của những user khác nhau.
   */
  const profile = storeProfile ?? props.initialProfile
  const theme = storeProfile ? storeTheme : props.theme
  const layout = storeProfile ? storeLayout : props.layout

  const templateId = storeProfile ? storeTemplateId : props.templateId
  const Template = getTemplate(templateId).component

  return (
    <div className="flex h-screen flex-col">
      {/* ── Thanh trên ─────────────────────────────────────────────────── */}
      <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-2">
        <h1 className="truncate font-medium">{props.title}</h1>
        <span className="text-ink-subtle">·</span>
        <SaveStatus />
        <div className="flex-1" />
        <UndoRedo />
        <CvLanguageSwitch />
        <button
          type="button"
          onClick={() => setDrawer((d) => (d === 'history' ? null : 'history'))}
          aria-pressed={drawer === 'history'}
          className="rounded-lg border border-border-strong px-3 py-1.5 text-sm hover:bg-canvas"
        >
          Lịch sử
        </button>
        <button
          type="button"
          onClick={() => setDrawer((d) => (d === 'chat' ? null : 'chat'))}
          aria-pressed={drawer === 'chat'}
          className="rounded-lg border border-brand-border bg-brand-subtle px-3 py-1.5 text-sm font-medium text-brand-ink hover:bg-brand-border"
        >
          Trợ lý
        </button>
        <a
          href={`/print/${props.cvId}?variant=presentation`}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg border border-border-strong px-3 py-1.5 text-sm hover:bg-canvas"
        >
          Xem bản in
        </a>
        <ExportButton cvId={props.cvId} />
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ── Mục lục (ẩn dưới 768px — FRONTEND.md §3.2) ─────────────── */}
        <aside className="hidden w-60 shrink-0 overflow-y-auto border-r border-border bg-surface p-2 md:block">
          <SectionOutline />
          <hr className="my-3 border-border" />
          <ThemePicker showTemplate />
        </aside>

        {/* ── Xem trước + sửa inline ─────────────────────────────────── */}
        <main className="min-w-0 flex-1 overflow-y-auto bg-canvas p-6">
          <div className="mx-auto w-fit">
            <FieldProvider renderer={editableRenderer}>
              <Template profile={profile} theme={theme} layout={layout} variant="screen" />
            </FieldProvider>
          </div>
          <p className="mx-auto mt-4 max-w-[210mm] text-center text-xs text-ink-muted">
            Bấm vào bất kỳ dòng nào để sửa trực tiếp. Enter để lưu, Escape để huỷ.
          </p>
        </main>

       </div>

      <Sheet open={drawer === 'chat'} onClose={() => setDrawer(null)} title="Trợ lý CV">
        <ChatPanel
          profileId={props.profileId}
          profile={profile}
          onProfileChange={(p) => useEditor.setState({ profile: p })}
        />
      </Sheet>

      <Sheet open={drawer === 'history'} onClose={() => setDrawer(null)} title="Lịch sử phiên bản">
        <VersionHistory
          profileId={props.profileId}
          onRestored={(p) => useEditor.setState({ profile: p })}
        />
      </Sheet>
    </div>
  )
}

function ExportButton({ cvId }: { cvId: string }) {
  return (
    <a
      href={`/api/cv/${cvId}/export`}
      className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white hover:bg-ink-muted"
    >
      Xuất PDF
    </a>
  )
}
