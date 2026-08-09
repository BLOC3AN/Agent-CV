'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import type { Profile } from '@hr/schema'
import { FieldProvider, getTemplate, type Layout, type Theme } from '@hr/templates'
import { useEditor } from '@/lib/editor-store'
import { editableRenderer } from './Editable'
import { CvLanguageSwitch } from './CvLanguageSwitch'
import { SectionOutline } from './SectionOutline'
import { UndoRedo, SaveStatus } from './UndoRedo'
import { ThemePicker } from './ThemePicker'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { useChat } from '@/lib/chat-store'
import { assistantWorkspaceState } from '@/lib/assistant-workspace'
import { VersionHistory } from './VersionHistory'
import { Sheet } from '@/components/ui'

/**
 * Khung màn hình soạn CV — FRONTEND.md §3.1.
 *
 * Bố cục workspace gồm mục lục, CV và sidebar trợ lý bên phải. Trợ lý mở sẵn
 * để người dùng có thể bắt đầu hỏi ngay; ở màn hình hẹp sidebar xếp bên dưới
 * bản xem trước thay vì che nội dung.
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
  startWithCv?: boolean
}

type Drawer = 'chat' | 'history' | null

export function BuilderShell(props: Props) {
  const [drawer, setDrawer] = useState<Drawer>(props.initialDrawer === undefined ? 'chat' : props.initialDrawer)
  const init = useEditor((s) => s.init)
  const storeProfile = useEditor((s) => s.profile)
  const storeTheme = useEditor((s) => s.theme)
  const storeLayout = useEditor((s) => s.layout)
  const storeTemplateId = useEditor((s) => s.templateId)
  const chatMessages = useChat((s) => s.messages)
  const workspaceState = props.startWithCv
    ? 'active'
    : assistantWorkspaceState(chatMessages, drawer, props.focusPath)

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

  // TopNav nằm ngoài BuilderShell; trừ chiều cao của nó để workspace không
  // cao hơn viewport và sidebar trợ lý luôn giữ được vùng nhập.
  return (
    <div className="builder-neo frontend-new flex h-screen min-h-0 flex-col overflow-hidden">
      {/* ── Thanh trên ─────────────────────────────────────────────────── */}
      <header className="builder-topbar flex items-center gap-3 border-b border-border bg-surface px-4 py-2">
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
          className="builder-control rounded-lg border border-border-strong px-3 py-1.5 text-sm hover:bg-canvas"
        >
          Lịch sử
        </button>
        <button
          type="button"
          onClick={() => setDrawer((d) => (d === 'chat' ? null : 'chat'))}
          aria-pressed={drawer === 'chat'}
          className="builder-control builder-control-ai rounded-lg border border-brand-border bg-brand-subtle px-3 py-1.5 text-sm font-medium text-brand-ink hover:bg-brand-border"
        >
          Trợ lý
        </button>
        <a
          href={`/print/${props.cvId}?variant=presentation`}
          target="_blank"
          rel="noreferrer"
          className="builder-control rounded-lg border border-border-strong px-3 py-1.5 text-sm hover:bg-canvas"
        >
          Xem bản in
        </a>
        <ExportButton cvId={props.cvId} />
      </header>

      <div
        data-assistant-state={workspaceState}
        className={`builder-workspace min-h-0 flex-1 flex-col lg:flex-row is-${workspaceState}`}
      >
        {/* ── Mục lục (ẩn dưới 768px — FRONTEND.md §3.2) ─────────────── */}
        <aside className="builder-outline hidden w-80 shrink-0 overflow-y-auto border-r border-border bg-surface p-2 md:block">
          <SectionOutline />
          <hr className="my-3 border-border" />
          <ThemePicker showTemplate />
        </aside>

        {/* ── Xem trước + sửa inline ─────────────────────────────────── */}
        <main className="builder-cv-stage min-h-0 min-w-0 overflow-y-auto bg-canvas p-6">
          <div className="mx-auto w-fit">
            <FieldProvider renderer={editableRenderer}>
              <Template profile={profile} theme={theme} layout={layout} variant="screen" />
            </FieldProvider>
          </div>
          <p className="mx-auto mt-4 max-w-[210mm] text-center text-xs text-ink-muted">
            Bấm vào bất kỳ dòng nào để sửa trực tiếp. Enter để lưu, Escape để huỷ.
          </p>
        </main>

        {drawer === 'chat' && (
          <aside
            aria-label="Trợ lý CV"
            className="builder-chat-dock chat-theme flex min-h-[360px] w-full shrink-0 flex-col border-t border-border bg-surface lg:min-h-0 lg:w-80 lg:border-l lg:border-t-0"
            style={{
              '--chat-accent': theme.accent ?? '#0D9488',
              '--chat-font': theme.fontFamily ?? 'inherit',
              '--chat-scale': theme.scale ?? 1,
              '--chat-line': theme.lineHeight ?? 1.5,
            } as CSSProperties}
          >
            <div className="builder-chat-header flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <span aria-hidden="true" className="builder-ai-mark">✦</span>
                <h2 className="text-[15px] font-semibold text-ink">Trợ lý CV</h2>
              </div>
              <button
                type="button"
                onClick={() => setDrawer(null)}
                aria-label="Đóng bảng Trợ lý CV"
                className="rounded-sm px-2 py-1 text-ink-muted hover:bg-canvas hover:text-ink"
              >
                <span aria-hidden="true">✕</span>
              </button>
            </div>
            <div className="builder-chat-body min-h-0 flex-1 overflow-y-auto px-4 py-4">
              <div className="builder-chat-intro mb-5">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-ink">HR-Agent AI</p>
                <h3 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
                  Mình cùng làm CV này tốt hơn nhé.
                </h3>
                <p className="mt-2 max-w-xl text-sm leading-6 text-ink-muted">
                  Hãy bắt đầu bằng một câu hỏi. Khi bạn gửi tin nhắn đầu tiên, bản CV sẽ mở ra bên cạnh để mình chỉnh cùng nhau.
                </p>
              </div>
              <ChatPanel
                profileId={props.profileId}
                profile={profile}
                onProfileChange={(p) => useEditor.setState({ profile: p })}
              />
            </div>
          </aside>
        )}
      </div>

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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const download = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/cv/${cvId}/export?variant=presentation`)
      const type = res.headers.get('content-type') ?? ''
      if (!res.ok || !type.toLowerCase().includes('application/pdf')) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? `Không tạo được PDF (HTTP ${res.status})`)
      }
      const blob = await res.blob()
      const href = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = href
      link.download = `CV-${cvId}.pdf`
      link.click()
      URL.revokeObjectURL(href)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void download()}
        disabled={busy}
        title="Tạo và tải bản PDF CV đã render"
        className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white hover:bg-ink-muted disabled:opacity-50"
      >
        {busy ? 'Đang tạo PDF…' : 'Tải xuống PDF'}
      </button>
      {error && <span role="alert" className="max-w-64 text-right text-xs text-danger">{error}</span>}
    </span>
  )
}
