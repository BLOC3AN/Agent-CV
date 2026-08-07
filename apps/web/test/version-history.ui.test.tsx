import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProfileSchema, type PatchOp, type Profile } from '@hr/schema'
import { VersionHistory } from '@/components/editor/VersionHistory'
import { useEditor } from '@/lib/editor-store'

/**
 * UC-34 — lịch sử phiên bản, kiểm ở tầng GIAO DIỆN.
 *
 * Trọng tâm: XEM được trước khi KHÔI PHỤC. Khôi phục huỷ mọi mốc mới hơn và
 * không lùi lại được, nên nó không được là cách duy nhất để biết một mốc chứa gì.
 */

function profile(over: Partial<Profile> = {}): Profile {
  return ProfileSchema.parse({
    schemaVersion: 1,
    language: 'vi',
    basics: { name: 'Nguyễn Văn A', headline: 'Backend Developer' },
    work: [{ org: 'Cty X', role: 'Dev', highlights: ['Xây dựng API bằng NodeJS'] }],
    ...over,
  })
}

const REVISIONS = [
  { id: '30', author: 'ai' as const, createdAt: new Date().toISOString(), opCount: 2 },
  { id: '20', author: 'user' as const, createdAt: new Date().toISOString(), opCount: 1 },
  { id: '10', author: 'import' as const, createdAt: new Date().toISOString(), opCount: 5 },
]

const OPS: PatchOp[] = [
  {
    op: 'replace',
    path: '/work/0/highlights/0',
    value: 'Xây dựng API NodeJS phục vụ 20 nghìn lượt mỗi ngày',
    rationale: 'Thêm số liệu',
    grounding: { type: 'user_message' },
    kbRefs: [],
  } as PatchOp,
]

/** Ảnh chụp mốc: trước là bản chưa có số liệu, sau là bản đã có */
const SNAPSHOT = {
  revisionId: '20',
  author: 'user',
  createdAt: new Date().toISOString(),
  ops: OPS,
  before: profile(),
  after: profile({
    work: [
      {
        org: 'Cty X',
        role: 'Dev',
        highlights: ['Xây dựng API NodeJS phục vụ 20 nghìn lượt mỗi ngày'],
      },
    ],
  }),
  newerCount: 1,
}

function stubFetch(over: { snapshot?: unknown; revert?: unknown } = {}) {
  const mock = vi.fn(async (url: string, init?: { method?: string }) => {
    if (init?.method === 'POST') {
      return { ok: true, json: async () => over.revert ?? { profile: profile() } } as Response
    }
    if (/\/revisions\/\d+$/.test(url)) {
      return { ok: true, json: async () => over.snapshot ?? SNAPSHOT } as Response
    }
    return { ok: true, json: async () => ({ revisions: REVISIONS }) } as Response
  })
  vi.stubGlobal('fetch', mock as unknown as typeof fetch)
  return mock
}

beforeEach(() => {
  // RevisionPreview lấy mẫu và theme từ editor store để render đúng CV đó
  useEditor.setState({ templateId: 'elegant', theme: {}, layout: {} })
})

const renderHistory = (onRestored = vi.fn()) =>
  render(<VersionHistory profileId="p-1" onRestored={onRestored} />)

describe('danh sách mốc', () => {
  it('mốc nào cũng xem lại được, kể cả bản hiện tại', async () => {
    stubFetch()
    renderHistory()

    const buttons = await screen.findAllByRole('button', { name: 'Xem lại bản này' })
    expect(buttons).toHaveLength(REVISIONS.length)
  })

  it('bản hiện tại KHÔNG có nút khôi phục — không có gì để quay về', async () => {
    stubFetch()
    renderHistory()

    await screen.findAllByRole('button', { name: 'Xem lại bản này' })
    // 3 mốc, mốc đầu là bản hiện tại
    expect(screen.getAllByRole('button', { name: 'Khôi phục về đây' })).toHaveLength(2)
  })
})

describe('xem lại một mốc trước khi khôi phục', () => {
  it('liệt kê thay đổi dạng "cũ → mới", không phải JSON Pointer thô', async () => {
    const user = userEvent.setup()
    stubFetch()
    renderHistory()

    await user.click((await screen.findAllByRole('button', { name: 'Xem lại bản này' }))[1]!)

    const dialog = await screen.findByRole('dialog', { name: /Xem lại bản cũ/ })
    // Giá trị cũ và giá trị mới đều phải thấy được (giá trị mới xuất hiện cả ở
    // danh sách thay đổi lẫn trong CV được render bên dưới)
    expect(await screen.findByText('Xây dựng API bằng NodeJS')).toBeInTheDocument()
    expect(screen.getAllByText(/20 nghìn lượt mỗi ngày/).length).toBeGreaterThan(0)
    // Tên mục bằng tiếng Việt, không phải "/work/0/highlights/0"
    expect(dialog.textContent).toContain('Kinh nghiệm')
    expect(dialog.textContent).not.toContain('/work/0/highlights')
  })

  it('render CV của mốc đó và TÔ SÁNG chỗ thay đổi', async () => {
    const user = userEvent.setup()
    stubFetch()
    const { container } = renderHistory()

    await user.click((await screen.findAllByRole('button', { name: 'Xem lại bản này' }))[1]!)
    await screen.findByRole('dialog', { name: /Xem lại bản cũ/ })

    await waitFor(() => {
      const marked = container.querySelectorAll('[class*="bg-amber-200"]')
      expect(marked.length).toBeGreaterThan(0)
    })
  })

  it('xem được CẢ HAI phía của mốc — bản khôi phục về là phía TRƯỚC', async () => {
    /*
     * "Khôi phục về đây" đưa hồ sơ về trạng thái NGAY TRƯỚC mốc. Nếu chỉ cho
     * xem phía "sau" thì người dùng duyệt một bản rồi nhận về một bản khác.
     */
    const user = userEvent.setup()
    stubFetch()
    renderHistory()

    await user.click((await screen.findAllByRole('button', { name: 'Xem lại bản này' }))[1]!)
    await screen.findByRole('dialog', { name: /Xem lại bản cũ/ })

    await user.click(screen.getByRole('button', { name: 'Trước mốc này' }))
    expect(screen.getByText(/chính là bản bạn nhận được/i)).toBeInTheDocument()
  })

  it('nói TRƯỚC số mốc sẽ mất khi khôi phục', async () => {
    const user = userEvent.setup()
    stubFetch()
    renderHistory()

    await user.click((await screen.findAllByRole('button', { name: 'Xem lại bản này' }))[1]!)
    const dialog = await screen.findByRole('dialog', { name: /Xem lại bản cũ/ })
    expect(dialog.textContent).toMatch(/1 mốc mới hơn/)
  })

  it('xem bản hiện tại thì KHÔNG hiện nút khôi phục trong hộp thoại', async () => {
    const user = userEvent.setup()
    stubFetch()
    renderHistory()

    await user.click((await screen.findAllByRole('button', { name: 'Xem lại bản này' }))[0]!)
    const dialog = await screen.findByRole('dialog', { name: /Xem lại bản cũ/ })
    expect(dialog.querySelector('footer')?.textContent).not.toContain('Khôi phục')
  })

  it('khôi phục ngay trong hộp thoại rồi đóng lại', async () => {
    const user = userEvent.setup()
    const mock = stubFetch()
    const onRestored = vi.fn()
    renderHistory(onRestored)

    await user.click((await screen.findAllByRole('button', { name: 'Xem lại bản này' }))[1]!)
    const dialog = await screen.findByRole('dialog', { name: /Xem lại bản cũ/ })
    await user.click(
      Array.from(dialog.querySelectorAll('button')).find(
        (b) => b.textContent === 'Khôi phục về đây',
      )!,
    )

    await waitFor(() => expect(onRestored).toHaveBeenCalled())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // Đúng mốc được gửi lên
    const post = mock.mock.calls.find((c) => (c[1] as { method?: string } | undefined)?.method === 'POST')!
    expect(JSON.parse((post[1] as unknown as { body: string }).body)).toEqual({ revisionId: '20' })
  })

  it('mốc đầu tiên không dựng lại được phía trước → vẫn xem được, chỉ tắt nút đó', async () => {
    const user = userEvent.setup()
    stubFetch({ snapshot: { ...SNAPSHOT, before: null, newerCount: 2 } })
    renderHistory()

    await user.click((await screen.findAllByRole('button', { name: 'Xem lại bản này' }))[2]!)
    await screen.findByRole('dialog', { name: /Xem lại bản cũ/ })
    expect(screen.getByRole('button', { name: 'Trước mốc này' })).toBeDisabled()
  })
})
