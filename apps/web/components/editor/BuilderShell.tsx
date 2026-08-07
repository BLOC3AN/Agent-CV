'use client'

import { useEffect, useState } from 'react'
import type { Profile } from '@hr/schema'
import { FieldProvider, getTemplate, type Layout, type Theme } from '@hr/templates'
import { useEditor } from '@/lib/editor-store'
import { editableRenderer } from './Editable'
import { SectionOutline } from './SectionOutline'
import { UndoRedo, SaveStatus } from './UndoRedo'
import { ThemePicker } from './ThemePicker'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { VersionHistory } from './VersionHistory'

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
}

type Drawer = 'chat' | 'history' | null

export function BuilderShell(props: Props) {
  const [drawer, setDrawer] = useState<Drawer>(null)
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
      <header className="flex items-center gap-3 border-b border-neutral-200 bg-white px-4 py-2">
        <h1 className="truncate font-medium">{props.title}</h1>
        <span className="text-neutral-300">·</span>
        <SaveStatus />
        <div className="flex-1" />
        <UndoRedo />
        <button
          type="button"
          onClick={() => setDrawer((d) => (d === 'history' ? null : 'history'))}
          aria-pressed={drawer === 'history'}
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
        >
          Lịch sử
        </button>
        <button
          type="button"
          onClick={() => setDrawer((d) => (d === 'chat' ? null : 'chat'))}
          aria-pressed={drawer === 'chat'}
          className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-1.5 text-sm font-medium text-sky-700 hover:bg-sky-100"
        >
          Trợ lý
        </button>
        <a
          href={`/print/${props.cvId}?variant=presentation`}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
        >
          Xem bản in
        </a>
        <ExportButton cvId={props.cvId} />
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ── Mục lục (ẩn dưới 768px — FRONTEND.md §3.2) ─────────────── */}
        <aside className="hidden w-60 shrink-0 overflow-y-auto border-r border-neutral-200 bg-white p-2 md:block">
          <SectionOutline />
          <hr className="my-3 border-neutral-200" />
          <ThemePicker showTemplate />
        </aside>

        {/* ── Xem trước + sửa inline ─────────────────────────────────── */}
        <main className="min-w-0 flex-1 overflow-y-auto bg-neutral-100 p-6">
          <div className="mx-auto w-fit">
            <FieldProvider renderer={editableRenderer}>
              <Template profile={profile} theme={theme} layout={layout} variant="screen" />
            </FieldProvider>
          </div>
          <p className="mx-auto mt-4 max-w-[210mm] text-center text-xs text-neutral-500">
            Bấm vào bất kỳ dòng nào để sửa trực tiếp. Enter để lưu, Escape để huỷ.
          </p>
        </main>

        {/* Slide-over: chiếm chỗ khi mở, trả lại toàn bộ bề ngang khi đóng */}
        {drawer && (
          <aside className="w-full shrink-0 overflow-y-auto border-l border-neutral-200 bg-white p-3 sm:w-96 dark:border-neutral-700 dark:bg-neutral-900">
            <div className="mb-2 flex justify-end">
              <button
                type="button"
                onClick={() => setDrawer(null)}
                aria-label="Đóng"
                className="rounded px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100"
              >
                ✕
              </button>
            </div>
            {drawer === 'chat' ? (
              <ChatPanel
                profileId={props.profileId}
                profile={profile}
                onProfileChange={(p) => useEditor.setState({ profile: p })}
              />
            ) : (
              <VersionHistory
                profileId={props.profileId}
                onRestored={(p) => useEditor.setState({ profile: p })}
              />
            )}
          </aside>
        )}
      </div>
    </div>
  )
}

function ExportButton({ cvId }: { cvId: string }) {
  return (
    <a
      href={`/api/cv/${cvId}/export`}
      className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700"
    >
      Xuất PDF
    </a>
  )
}
