import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProfileSchema, type Profile, type PatchOp } from '@hr/schema'
import { CvLanguageSwitch } from '@/components/editor/CvLanguageSwitch'
import { useEditor } from '@/lib/editor-store'

/**
 * FRONTEND §9.6 — ba trục ngôn ngữ ĐỘC LẬP: giao diện, CV, JD.
 *
 * Công tắc này đổi trục CV. Nó KHÔNG dịch nội dung — chỉ đổi ngôn ngữ khai
 * báo, và tiêu đề mục do template sinh sẽ đi theo. Nếu giao diện không nói rõ
 * điều đó, người dùng bấm EN rồi chờ CV tự dịch và kết luận sản phẩm hỏng.
 */

const p = (language: 'vi' | 'en' = 'vi'): Profile =>
  ProfileSchema.parse({
    schemaVersion: 1,
    language,
    basics: { name: 'Nguyễn Văn A' },
  })

beforeEach(() => {
  useEditor.setState({ profile: p(), applyUser: vi.fn(async () => {}) } as never)
})

describe('CvLanguageSwitch', () => {
  it('là một nhóm có tên, không phải hai nút rời rạc', () => {
    render(<CvLanguageSwitch />)
    expect(screen.getByRole('group', { name: /Ngôn ngữ CV/ })).toBeInTheDocument()
  })

  it('đánh dấu ngôn ngữ đang chọn cho trình đọc màn hình', () => {
    render(<CvLanguageSwitch />)
    expect(screen.getByRole('button', { name: 'Tiếng Việt' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('bấm EN phát đúng một op replace vào /language', async () => {
    // Gõ tường minh tham số ops: PatchOp[] để khớp chữ ký applyUser thật —
    // nếu không, TS suy ra Mock<[], ...> và `mock.calls[0][0]` không có kiểu.
    const applyUser = vi.fn(async (_ops: PatchOp[]) => {})
    useEditor.setState({ profile: p(), applyUser } as never)

    render(<CvLanguageSwitch />)
    await userEvent.click(screen.getByRole('button', { name: 'English' }))

    expect(applyUser).toHaveBeenCalledOnce()
    const ops = applyUser.mock.calls[0]![0] as unknown as Array<Record<string, unknown>>
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ op: 'replace', path: '/language', value: 'en' })
  })

  it('op mang grounding user_message — đây là thao tác của NGƯỜI, không phải AI', async () => {
    const applyUser = vi.fn(async (_ops: PatchOp[]) => {})
    useEditor.setState({ profile: p(), applyUser } as never)

    render(<CvLanguageSwitch />)
    await userEvent.click(screen.getByRole('button', { name: 'English' }))

    const ops = applyUser.mock.calls[0]![0] as unknown as Array<Record<string, unknown>>
    expect(ops[0]!['grounding']).toMatchObject({ type: 'user_message' })
  })

  it('bấm lại ngôn ngữ ĐANG chọn thì không phát op nào', async () => {
    const applyUser = vi.fn(async () => {})
    useEditor.setState({ profile: p('vi'), applyUser } as never)

    render(<CvLanguageSwitch />)
    await userEvent.click(screen.getByRole('button', { name: 'Tiếng Việt' }))

    expect(applyUser).not.toHaveBeenCalled()
  })

  it('nói RÕ là không dịch nội dung', () => {
    render(<CvLanguageSwitch />)
    expect(screen.getByText(/không dịch nội dung/i)).toBeInTheDocument()
  })

  it('hồ sơ đang là en thì EN được đánh dấu chọn', () => {
    useEditor.setState({ profile: p('en'), applyUser: vi.fn(async () => {}) } as never)
    render(<CvLanguageSwitch />)
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})
