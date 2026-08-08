'use client'

import { create } from 'zustand'
import type { Profile, PatchOp } from '@hr/schema'
import type { Layout, Theme } from '@hr/templates'

/**
 * Editor store — FRONTEND.md §9.2.
 *
 * Điểm cốt lõi (BR-24.1): thao tác của NGƯỜI và của AI đi qua CÙNG đường ống
 * JSON Patch → MỘT lịch sử undo duy nhất, không cần hai cơ chế song song.
 *
 * Phân biệt optimistic update (FRONTEND.md §9.2):
 *   · Người sửa tay  → cập nhật UI NGAY, đồng bộ server ngầm, rollback nếu lỗi
 *   · AI đề xuất     → KHÔNG BAO GIỜ optimistic. Chỉ áp sau khi user bấm duyệt.
 */

export interface PendingProposal {
  id: string
  ops: PatchOp[]
  summary: string
}

interface HistoryEntry {
  ops: PatchOp[]
  /** Ảnh chụp Profile TRƯỚC khi áp — dùng để undo cục bộ tức thì */
  before: Profile
  source: 'user' | 'ai'
}

export type SaveState = 'idle' | 'saving' | 'error'

interface EditorState {
  profileId: string | null
  cvId: string | null
  profile: Profile | null
  templateId: string
  theme: Partial<Theme>
  layout: Partial<Layout>

  undoStack: HistoryEntry[]
  redoStack: HistoryEntry[]
  /** Đề xuất của AI chờ user duyệt — KHÔNG tự áp (TDD A3) */
  pendingProposals: PendingProposal[]

  saveState: SaveState
  lastError: string | null
  /** Field đang được sửa — dùng để tô sáng mục tương ứng ở SectionOutline */
  activePath: string | null

  init: (p: {
    profileId: string
    cvId: string
    profile: Profile
    templateId?: string
    theme?: Partial<Theme>
    layout?: Partial<Layout>
  }) => void
  setActivePath: (path: string | null) => void

  /** Người dùng sửa tay — optimistic + đồng bộ ngầm */
  applyUser: (ops: PatchOp[]) => Promise<void>
  /** Áp các op đã được user duyệt từ một đề xuất của AI */
  applyAccepted: (proposalId: string, opIndexes: number[]) => Promise<void>
  addProposal: (p: PendingProposal) => void
  dismissProposal: (id: string) => void

  undo: () => Promise<void>
  redo: () => Promise<void>

  setTheme: (t: Partial<Theme>) => void
  setLayout: (l: Partial<Layout>) => void
  setTemplate: (id: string) => void
}

/**
 * Lưu phần TRÌNH BÀY xuống /api/cv/:id, gộp nhiều thay đổi liên tiếp.
 * Kéo thanh trượt cỡ chữ sinh hàng chục sự kiện — không thể mỗi cái một request.
 */
let presentTimer: ReturnType<typeof setTimeout> | null = null
function persistPresentation(
  cvId: string | null,
  body: Record<string, unknown>,
): void {
  if (!cvId) return
  if (presentTimer) clearTimeout(presentTimer)
  presentTimer = setTimeout(() => {
    /*
     * Bọc trong Promise.resolve + try: `fetch` có thể ném ĐỒNG BỘ (mạng chết,
     * môi trường lạ), lúc đó `.catch()` không bắt được và lỗi thoát ra ngoài.
     * Lưu trình bày hụt chỉ mất tuỳ chỉnh hiển thị — KHÔNG được làm hỏng editor
     * hay mất dữ liệu CV, nên nuốt lỗi ở đây là đúng.
     */
    try {
      void Promise.resolve(
        fetch(`/api/cv/${cvId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      ).catch(() => {})
    } catch {
      /* bỏ qua — xem giải thích ở trên */
    }
  }, 600)
}

/** Áp patch tại chỗ trong trình duyệt — cùng thuật toán với server */
function applyLocal(profile: Profile, ops: PatchOp[]): Profile {
  const doc = structuredClone(profile) as unknown as Record<string, unknown>
  for (const op of ops) {
    const parts = op.path.split('/').slice(1).map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'))
    let cur: unknown = doc
    for (const p of parts.slice(0, -1)) {
      cur = (cur as Record<string, unknown>)[p]
      if (cur == null) return profile
    }
    const last = parts[parts.length - 1]!
    if (Array.isArray(cur)) {
      const i = last === '-' ? cur.length : Number(last)
      if (op.op === 'remove') cur.splice(i, 1)
      else if (op.op === 'add') cur.splice(i, 0, op.value)
      else cur[i] = op.value
    } else if (cur && typeof cur === 'object') {
      const o = cur as Record<string, unknown>
      if (op.op === 'remove') delete o[last]
      else o[last] = op.value
    }
  }
  return doc as unknown as Profile
}

async function pushPatch(
  profileId: string,
  ops: PatchOp[],
  author: 'user' | 'ai',
): Promise<{ profile: Profile; rejected: { path: string; reason: string }[] }> {
  const res = await fetch(`/api/profiles/${profileId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ops, author }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  return (await res.json()) as {
    profile: Profile
    rejected: { path: string; reason: string }[]
  }
}

export const useEditor = create<EditorState>((set, get) => ({
  profileId: null,
  cvId: null,
  profile: null,
  templateId: 'elegant',
  theme: {},
  layout: {},
  undoStack: [],
  redoStack: [],
  pendingProposals: [],
  saveState: 'idle',
  lastError: null,
  activePath: null,

  init: ({ profileId, cvId, profile, templateId, theme, layout }) =>
    set({
      profileId,
      cvId,
      profile,
      templateId: templateId ?? 'elegant',
      theme: theme ?? {},
      layout: layout ?? {},
      undoStack: [],
      redoStack: [],
      saveState: 'idle',
      lastError: null,
    }),

  setActivePath: (activePath) => set({ activePath }),

  async applyUser(ops) {
    const { profile, profileId } = get()
    if (!profile || !profileId || ops.length === 0) return

    const before = profile
    // Optimistic: UI đổi ngay, không chờ mạng
    set({
      profile: applyLocal(profile, ops),
      undoStack: [...get().undoStack, { ops, before, source: 'user' as const }].slice(-60),
      redoStack: [],
      saveState: 'saving',
      lastError: null,
    })

    try {
      const r = await pushPatch(profileId, ops, 'user')
      // Lấy bản server làm chuẩn — server có thể chuẩn hoá thêm
      set({ profile: r.profile, saveState: 'idle' })
      if (r.rejected.length > 0) {
        set({ lastError: `${r.rejected.length} thay đổi không áp dụng được` })
      }
    } catch (err) {
      // TC-24-03: rollback về trạng thái trước, báo lỗi
      set({
        profile: before,
        undoStack: get().undoStack.slice(0, -1),
        saveState: 'error',
        lastError: (err as Error).message,
      })
    }
  },

  async applyAccepted(proposalId, opIndexes) {
    const { profile, profileId, pendingProposals } = get()
    const proposal = pendingProposals.find((p) => p.id === proposalId)
    if (!profile || !profileId || !proposal) return

    const ops = opIndexes.map((i) => proposal.ops[i]).filter(Boolean) as PatchOp[]
    if (ops.length === 0) return

    const before = profile
    set({ saveState: 'saving', lastError: null })
    try {
      // KHÔNG optimistic cho AI — chỉ đổi UI sau khi server xác nhận (TDD A3)
      const r = await pushPatch(profileId, ops, 'ai')
      set({
        profile: r.profile,
        undoStack: [...get().undoStack, { ops, before, source: 'ai' as const }].slice(-60),
        redoStack: [],
        pendingProposals: pendingProposals.filter((p) => p.id !== proposalId),
        saveState: 'idle',
      })
    } catch (err) {
      set({ saveState: 'error', lastError: (err as Error).message })
    }
  },

  addProposal: (p) =>
    set({ pendingProposals: [...get().pendingProposals, p] }),

  dismissProposal: (id) =>
    set({ pendingProposals: get().pendingProposals.filter((p) => p.id !== id) }),

  /**
   * TC-54-01/02 — undo hoạt động ĐỒNG NHẤT cho thay đổi của user và của AI.
   * Cùng một stack, cùng một hàm.
   */
  async undo() {
    const { undoStack, profileId, profile } = get()
    const last = undoStack[undoStack.length - 1]
    if (!last || !profileId || !profile) return

    set({
      profile: last.before,
      undoStack: undoStack.slice(0, -1),
      redoStack: [...get().redoStack, { ...last, before: profile }],
      saveState: 'saving',
    })
    try {
      const res = await fetch(`/api/profiles/${profileId}/undo`, { method: 'POST' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { profile: server } = (await res.json()) as { profile: Profile }
      set({ profile: server, saveState: 'idle' })
    } catch (err) {
      set({ saveState: 'error', lastError: (err as Error).message })
    }
  },

  async redo() {
    const { redoStack } = get()
    const entry = redoStack[redoStack.length - 1]
    if (!entry) return
    set({ redoStack: redoStack.slice(0, -1) })
    await get().applyUser(entry.ops)
  },

  setTheme: (t) => {
    const theme = { ...get().theme, ...t }
    set({ theme })
    persistPresentation(get().cvId, { theme })
  },
  setLayout: (l) => {
    const layout = { ...get().layout, ...l }
    set({ layout })
    persistPresentation(get().cvId, { layout })
  },
  setTemplate: (templateId) => {
    // BR-31.2: đổi mẫu KHÔNG đụng tới Profile
    set({ templateId })
    persistPresentation(get().cvId, { templateId })
  },
}))

export { applyLocal }
