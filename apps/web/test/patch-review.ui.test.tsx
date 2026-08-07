import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProfileSchema, type PatchOp, type Profile } from '@hr/schema'
import { PatchReviewModal, defaultChecked, readAt } from '@/components/chat/PatchReviewModal'

/**
 * TC-53-* — modal duyệt đề xuất, kiểm ở tầng GIAO DIỆN.
 *
 * Vì sao cần dù đã có test cho `validateOps`: BR-53.1 nói "AI không bao giờ ghi
 * thẳng vào hồ sơ". Ràng buộc đó chỉ giữ được nếu MODAL cư xử đúng — tick sẵn
 * đúng op, không tick op suy diễn, và chỉ gửi đi những op user đã chọn.
 *
 * Đây là lớp test còn thiếu: mọi lỗi giao diện tới giờ đều do người dùng phát
 * hiện, không phải do test.
 */

function profile(over: Partial<Profile> = {}): Profile {
  return ProfileSchema.parse({
    schemaVersion: 1,
    language: 'vi',
    basics: { name: 'Nguyễn Văn A' },
    work: [{ org: 'Cty X', role: 'Dev', highlights: ['Xây dựng API bằng NodeJS'] }],
    ...over,
  })
}

function op(over: Partial<PatchOp> = {}): PatchOp {
  return {
    op: 'replace',
    path: '/work/0/role',
    value: 'Backend Developer',
    rationale: 'Chức danh cụ thể hơn giúp nhà tuyển dụng hình dung vai trò',
    grounding: { type: 'existing_field', ref: '/work/0/role' },
    kbRefs: [],
    ...over,
  } as PatchOp
}

function renderModal(ops: PatchOp[], onApplied = vi.fn(), onDismiss = vi.fn()) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ profile: profile(), applied: ops.length }),
  })) as unknown as typeof fetch
  vi.stubGlobal('fetch', fetchMock)

  render(
    <PatchReviewModal
      data={{ proposalId: 'p-1', summary: 'Tóm tắt đề xuất', ops, rejected: [] }}
      profile={profile()}
      profileId="prof-1"
      onApplied={onApplied}
      onDismiss={onDismiss}
    />,
  )
  return { fetchMock, onApplied, onDismiss }
}

function bodyOf(fetchMock: ReturnType<typeof vi.fn>): { accept: number[] } {
  const call = (fetchMock as unknown as { mock: { calls: [string, { body: string }][] } }).mock
    .calls[0]
  return JSON.parse(call![1].body) as { accept: number[] }
}

describe('defaultChecked — op nào được tick sẵn (UC-53 bước 2-3)', () => {
  it('op có nguồn kiểm chứng được → tick sẵn', () => {
    const ops = [
      op({ grounding: { type: 'user_message', ref: 'm1' } }),
      op({ grounding: { type: 'existing_field', ref: '/work/0/role' } }),
      op({ grounding: { type: 'kb', ref: 'g_x' } }),
    ]
    expect(defaultChecked(ops)).toEqual([0, 1, 2])
  })

  it('op AI TỰ SUY RA → KHÔNG tick sẵn', () => {
    const ops = [op(), op({ grounding: { type: 'inference', ref: 'suy' } }), op()]
    expect(defaultChecked(ops)).toEqual([0, 2])
  })

  it('toàn bộ là suy diễn → không tick gì cả', () => {
    expect(defaultChecked([op({ grounding: { type: 'inference', ref: 'x' } })])).toEqual([])
  })
})

describe('readAt — hiện giá trị TRƯỚC khi sửa', () => {
  it('đọc được chuỗi lồng sâu', () => {
    expect(readAt(profile(), '/work/0/role')).toBe('Dev')
    expect(readAt(profile(), '/work/0/highlights/0')).toBe('Xây dựng API bằng NodeJS')
  })

  it('đường dẫn không có → chuỗi rỗng, không ném lỗi', () => {
    expect(readAt(profile(), '/work/9/role')).toBe('')
    expect(readAt(profile(), '/khong/co')).toBe('')
  })

  it('mảng hiện thành chuỗi đọc được', () => {
    expect(readAt(profile(), '/work/0/highlights')).toContain('NodeJS')
  })
})

describe('modal duyệt đề xuất', () => {
  it('hiện số lượng và tóm tắt', () => {
    renderModal([op(), op({ path: '/work/0/org' })])
    expect(screen.getByText(/2 thay đổi/)).toBeInTheDocument()
    expect(screen.getByText('Tóm tắt đề xuất')).toBeInTheDocument()
  })

  it('hiện diff TRƯỚC → SAU cho từng op', () => {
    renderModal([op()])
    expect(screen.getByText('Dev')).toBeInTheDocument()
    expect(screen.getByText('Backend Developer')).toBeInTheDocument()
  })

  it('hiện LÝ DO — người dùng cần biết vì sao mới quyết được', () => {
    renderModal([op()])
    expect(screen.getByText(/Chức danh cụ thể hơn/)).toBeInTheDocument()
  })

  it('op suy diễn hiện CẢNH BÁO và không tick sẵn', () => {
    renderModal([op({ grounding: { type: 'inference', ref: 'x' } })])

    // Cảnh báo xuất hiện HAI chỗ: banner đầu modal và nhãn dưới từng op
    expect(screen.getAllByText(/AI tự suy luận/).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText(/1 thay đổi do AI tự suy luận/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).not.toBeChecked()
  })

  it('CHỈ gửi những op user đã tick (BR-53.1)', async () => {
    const user = userEvent.setup()
    const { fetchMock } = renderModal([op(), op({ path: '/work/0/org' }), op({ path: '/basics/name' })])

    // Bỏ tick op giữa
    await user.click(screen.getAllByRole('checkbox')[1]!)
    await user.click(screen.getByRole('button', { name: /Áp dụng/ }))

    expect(bodyOf(fetchMock as never).accept).toEqual([0, 2])
  })

  it('"Bỏ qua tất cả" gửi mảng RỖNG, không đụng hồ sơ (UC-53 5a)', async () => {
    const user = userEvent.setup()
    const { fetchMock, onDismiss } = renderModal([op(), op({ path: '/work/0/org' })])

    await user.click(screen.getByRole('button', { name: /Bỏ qua tất cả/ }))

    expect(bodyOf(fetchMock as never).accept).toEqual([])
    expect(onDismiss).toHaveBeenCalled()
  })

  it('bỏ tick HẾT thì nút Áp dụng bị vô hiệu (UC-53 4a)', async () => {
    const user = userEvent.setup()
    renderModal([op()])

    await user.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('button', { name: /Áp dụng/ })).toBeDisabled()
  })

  it('nút Áp dụng hiện ĐÚNG số mục đã chọn', async () => {
    const user = userEvent.setup()
    renderModal([op(), op({ path: '/work/0/org' }), op({ path: '/basics/name' })])

    expect(screen.getByRole('button', { name: /Áp dụng 3 mục/ })).toBeInTheDocument()
    await user.click(screen.getAllByRole('checkbox')[0]!)
    expect(screen.getByRole('button', { name: /Áp dụng 2 mục/ })).toBeInTheDocument()
  })

  it('op bị loại hiện ra kèm lý do, không im lặng bỏ đi (UC-53 6a)', () => {
    render(
      <PatchReviewModal
        data={{
          proposalId: 'p',
          summary: 's',
          ops: [op()],
          rejected: [{ path: '/work/9/role', reason: 'Đường dẫn không có trong hồ sơ' }],
        }}
        profile={profile()}
        profileId="prof-1"
        onApplied={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    expect(screen.getByText(/1 đề xuất bị loại/)).toBeInTheDocument()
    expect(screen.getByText(/Đường dẫn không có trong hồ sơ/)).toBeInTheDocument()
  })

  it('lỗi từ server hiện cho user, không im lặng', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({ error: 'Đề xuất này đã accepted' }) })),
    )
    render(
      <PatchReviewModal
        data={{ proposalId: 'p', summary: 's', ops: [op()], rejected: [] }}
        profile={profile()}
        profileId="prof-1"
        onApplied={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /Áp dụng/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Đề xuất này đã accepted')
  })

  it('op `remove` hiện rõ là XOÁ, không hiện ô trống', () => {
    renderModal([op({ op: 'remove', path: '/work/0/role', value: undefined })])
    expect(screen.getByText('(xoá)')).toBeInTheDocument()
  })

  it('modal có vai trò dialog và nhãn cho trình đọc màn hình', () => {
    renderModal([op()])
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleName()
  })
})
