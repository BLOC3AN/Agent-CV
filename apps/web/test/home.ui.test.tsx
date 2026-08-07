import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProfileSchema, type Profile } from '@hr/schema'
import { profileCompleteness } from '@hr/matching'
import { IntentRouter, ENTRIES } from '@/components/home/IntentRouter'
import { ReturningHome } from '@/components/home/ReturningHome'
import { ResumeHome } from '@/components/home/ResumeHome'
import { nextStepFor } from '@/lib/home-state'

/**
 * TC-01-*, TC-02-*, TC-03-* ở tầng GIAO DIỆN — UC-01/02/03.
 *
 * Home cũ có đúng một nút "Tải CV lên", giả định người dùng đã có CV và biết
 * mình cần sửa gì. Nhóm test này giữ cho ba màn hình Home nói đúng thứ chúng
 * hứa, và giữ cho con số phần trăm luôn tra được nguồn.
 */

const p = (over: Partial<Profile> = {}): Profile =>
  ProfileSchema.parse({ schemaVersion: 1, language: 'vi', basics: { name: 'A' }, ...over })

const full = (): Profile =>
  p({
    basics: { name: 'A', email: 'a@example.com', summary: 'Kỹ sư phần mềm.' },
    work: [{ org: 'ABC', role: 'Dev', highlights: ['Giảm 40% thời gian xử lý'] }],
    education: [{ school: 'X', degree: 'Kỹ sư' }],
    skills: ['a', 'b', 'c', 'd', 'e'].map((n) => ({ name: n })),
  } as never)

describe('Home lần đầu — bộ định tuyến ý định (UC-01)', () => {
  it('hỏi người dùng đang ở đâu, không chỉ mời tải CV lên', () => {
    render(<IntentRouter />)
    expect(screen.getByText(/Bạn cần giúp gì/i)).toBeInTheDocument()
    // Bốn tình trạng, không phải bốn tính năng
    expect(screen.getByText('Tôi đã có CV')).toBeInTheDocument()
    expect(screen.getByText('Tôi chưa có CV nào')).toBeInTheDocument()
    expect(screen.getByText(/Tôi không biết CV mình dở ở đâu/)).toBeInTheDocument()
    expect(screen.getByText(/Tôi có việc muốn ứng tuyển/)).toBeInTheDocument()
  })

  it('TC-01-04 nhãn là câu NGƯỜI DÙNG tự nói, không phải tên tính năng', () => {
    render(<IntentRouter />)
    // "Đối chiếu JD" là từ của người làm sản phẩm (BR-01.2)
    expect(screen.queryByText(/Đối chiếu JD/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Parse CV/i)).not.toBeInTheDocument()
    for (const e of ENTRIES) expect(e.title.startsWith('Tôi ')).toBe(true)
  })

  it('TC-01-03 mọi lối vào đều dẫn tới màn hình CÓ THẬT', () => {
    // Nút dẫn tới 404 còn tệ hơn không có nút: người bấm vào nghĩ hệ thống hỏng.
    // Lối vào nào chưa dựng xong thì KHÔNG được là link (`soon`), và phải nói
    // thẳng ra. Kiểm 404 thật nằm ở lớp E2E (apps/web/test/e2e.int.test.ts).
    render(<IntentRouter />)
    const links = screen.getAllByRole('link')
    const ready = ENTRIES.filter((e) => !e.soon)
    expect(links).toHaveLength(ready.length)

    for (const e of ENTRIES) {
      if (e.soon) expect(links.some((a) => a.getAttribute('href') === e.href)).toBe(false)
      else expect(links.some((a) => a.getAttribute('href') === e.href)).toBe(true)
    }
  })

  it('lối vào cho nhóm hoang mang được làm NỔI BẬT', () => {
    // Nhóm đông nhất và bị bỏ rơi nặng nhất (PRODUCT §2)
    expect(ENTRIES.find((e) => e.featured)!.title).toMatch(/không biết/)
  })
})

describe('Home quay lại (UC-02)', () => {
  const renderReturning = (profile: Profile, over: Record<string, unknown> = {}) =>
    render(
      <ReturningHome
        greeting="Chào buổi chiều, Hải"
        completeness={profileCompleteness(profile)}
        cv={{ id: 'cv1', title: 'CV Computer Vision Engineer', updatedAt: '2 giờ trước' }}
        profile={profile}
        nextStep={nextStepFor(profileCompleteness(profile), { cvId: 'cv1', hasAnalysis: false })}
        matches={[]}
        aiAvailable={true}
        {...over}
      />,
    )

  it('TC-01-02 KHÔNG bắt onboarding lại', () => {
    renderReturning(full())
    expect(screen.queryByText(/Bạn cần giúp gì/i)).not.toBeInTheDocument()
    // Điều test này canh giữ là "có lối đi tiếp thẳng vào CV đang dở", không
    // phải một chuỗi tiêu đề cụ thể — tiêu đề đổi mà lối đi vẫn còn thì test
    // không được đỏ oan.
    expect(screen.getByRole('link', { name: /Tiếp tục chỉnh CV/ })).toBeInTheDocument()
  })

  it('TC-02-03 bấm vào phần trăm xem được nó GỒM NHỮNG GÌ', async () => {
    // Không phần trăm nào mà người dùng không tra được nguồn (BR-02.1)
    const user = userEvent.setup()
    renderReturning(p())

    expect(screen.queryByText('Học vấn')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Gồm những gì/ }))

    expect(screen.getByText('Học vấn')).toBeInTheDocument()
    expect(screen.getByText('Kỹ năng')).toBeInTheDocument()
    expect(screen.getByText(/Kinh nghiệm hoặc dự án/)).toBeInTheDocument()
  })

  it('TC-02-04 phần CHƯA xong hiện kèm việc cần làm', async () => {
    const user = userEvent.setup()
    renderReturning(p())
    await user.click(screen.getByRole('button', { name: /Gồm những gì/ }))
    expect(screen.getByText(/Viết vài dòng giới thiệu/)).toBeInTheDocument()
  })

  it('con số khớp với phép tính, không phải số cứng', () => {
    renderReturning(full())
    expect(screen.getByText('100%')).toBeInTheDocument()
  })

  it('TC-02-05 hiện MỘT việc nên làm tiếp', () => {
    renderReturning(p())
    expect(screen.getByRole('link', { name: /Sửa cùng trợ lý/ })).toBeInTheDocument()
  })

  it('TC-02-06 không còn gì đáng làm → nói thẳng, KHÔNG bịa việc', () => {
    render(
      <ReturningHome
        greeting="Chào"
        completeness={profileCompleteness(full())}
        cv={null}
        profile={null}
        nextStep={null}
        matches={[]}
        aiAvailable={true}
      />,
    )
    expect(screen.getByText(/đang ổn/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Sửa cùng trợ lý/ })).not.toBeInTheDocument()
  })

  it('đối chiếu gần đây dẫn về đúng CV', () => {
    renderReturning(full(), {
      matches: [{ jdTitle: 'Bosch CV Engineer', overall: 81, cvId: 'cv9' }],
    })
    const a = screen.getByRole('link', { name: /Bosch CV Engineer/ })
    expect(a).toHaveAttribute('href', '/analyze/cv9')
    // Không còn dấu `%` — điểm khớp không tô màu/định dạng như một ngưỡng
    // tuyệt đối (TDD §8.2.3), chỉ còn con số trần.
    expect(screen.getByText('81')).toBeInTheDocument()
  })
})

describe('Home tiếp tục việc dở dang (UC-03)', () => {
  const job = (over = {}) =>
    ({ id: 'j1', status: 'running', createdAt: new Date(), filename: 'CV-Hai.pdf', ...over }) as never

  it('nhận ra file người dùng đã tải lên', () => {
    render(<ResumeHome job={job()} />)
    expect(screen.getByText('CV-Hai.pdf')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Tiếp tục' })).toHaveAttribute(
      'href',
      '/import/j1/review',
    )
  })

  it('TC-03-04 job HỎNG nói rõ hỏng gì và mời làm tiếp', () => {
    // Không im lặng đưa họ về màn hình đầu như chưa có chuyện gì
    render(<ResumeHome job={job({ status: 'failed' })} />)
    expect(screen.getByText(/chưa đọc được/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Thử tải lại/ })).toBeInTheDocument()
    expect(screen.getByText(/nhập tay/)).toBeInTheDocument()
  })

  it('luôn có lối thoát sang cách khác', () => {
    render(<ResumeHome job={job()} />)
    expect(screen.getByRole('link', { name: /file khác/ })).toBeInTheDocument()
  })
})

describe('ReturningHome — bố cục mới', () => {
  const base = {
    greeting: 'Chào buổi tối, Hải',
    completeness: profileCompleteness(p()),
    cv: { id: 'cv-1', title: 'LE THANH HAI', updatedAt: '6 giờ trước' },
    profile: p(),
    nextStep: null,
    matches: [],
    aiAvailable: true,
  }

  it('hiện bản CV thu nhỏ — sản phẩm xoay quanh tài liệu, phải thấy nó', () => {
    const { container } = render(<ReturningHome {...base} />)
    expect(container.querySelector('[data-variant="thumbnail"]')).toBeInTheDocument()
  })

  it('không có hồ sơ thì không cố vẽ thumbnail', () => {
    const { container } = render(<ReturningHome {...base} profile={null} />)
    expect(container.querySelector('[data-variant="thumbnail"]')).not.toBeInTheDocument()
  })

  it('gợi ý của trợ lý đi qua AiPanel — mang chữ ký AI', () => {
    const { container } = render(
      <ReturningHome
        {...base}
        nextStep={{ text: 'Thêm số liệu vào các gạch đầu dòng', cta: 'Cùng tôi sửa', href: '/builder/cv-1' }}
      />,
    )
    expect(container.querySelector('[data-variant="ai"]')).toBeInTheDocument()
  })

  it('trợ lý chết: khối vẫn còn và nói việc gì vẫn làm được', () => {
    render(
      <ReturningHome
        {...base}
        aiAvailable={false}
        nextStep={{ text: 'Thêm số liệu', cta: 'Cùng tôi sửa', href: '/builder/cv-1' }}
      />,
    )
    expect(screen.getByText(/tạm ngưng/)).toBeInTheDocument()
    expect(screen.getByText(/vẫn sửa CV, đổi mẫu và tải file/)).toBeInTheDocument()
  })

  it('trợ lý chết: nút "Tiếp tục chỉnh CV" VẪN bấm được — nó không cần AI', () => {
    render(<ReturningHome {...base} aiAvailable={false} />)
    expect(screen.getByRole('link', { name: /Tiếp tục chỉnh CV/ })).toBeInTheDocument()
  })

  it('mỗi dòng đối chiếu có mốc thời gian để phân biệt', () => {
    render(
      <ReturningHome
        {...base}
        matches={[
          { jdTitle: 'Junior Full-stack Developer', overall: 44, cvId: 'cv-1', jdId: 'jd-1', when: 'hôm nay' },
          { jdTitle: 'Backend Developer', overall: 72, cvId: 'cv-1', jdId: 'jd-2', when: '3 ngày trước' },
        ]}
      />,
    )
    expect(screen.getByText('hôm nay')).toBeInTheDocument()
    expect(screen.getByText('3 ngày trước')).toBeInTheDocument()
  })

  it('điểm khớp KHÔNG tô màu — TDD §8.2.3 cấm khẳng định ngưỡng tuyệt đối', () => {
    const { container } = render(
      <ReturningHome
        {...base}
        matches={[{ jdTitle: 'X', overall: 44, cvId: 'cv-1', jdId: 'jd-1', when: 'hôm nay' }]}
      />,
    )
    // Kiểm bằng data-tone chứ không bằng className: Global Constraints cấm test
    // bám vào chuỗi class, và một ngày nào đó đổi tên utility sẽ làm test đỏ
    // mà chẳng có hành vi nào sai. `data-tone` là hợp đồng, class là chi tiết.
    expect(screen.getByText('44')).toBeInTheDocument()
    expect(container.querySelector('[data-tone]')).not.toBeInTheDocument()
  })
})
