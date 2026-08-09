import type { Profile } from '@hr/schema'
import { allHighlights, containsNumber } from './rubric.js'

/**
 * Mức đầy đủ hồ sơ — UC-02, BR-02.1, PRODUCT §6.1.
 *
 * ── Vì sao không ước lượng đại ──
 * "Hồ sơ đã đầy đủ 82%" là chỗ dễ bịa nhất trong cả sản phẩm: không ai kiểm
 * được, và nó trông có vẻ thông minh. Nhưng dự án này đã cấm AI bịa số
 * (BR-52.1) và đã trả giá cho việc vẽ thanh đo sai thứ (TDD §8.2). Một con số
 * bịa ở màn hình đầu tiên làm hỏng niềm tin vào mọi thứ phía sau nó.
 *
 * Nên hàm này trả về CẢ bảng thành phần, không chỉ con số. Giao diện bắt buộc
 * cho người dùng xem được bảng đó — bấm vào "82%" phải ra đúng thứ tạo nên 82.
 */

export interface CompletenessPart {
  key: string
  /** Nhãn tiếng Việt cho người đọc */
  label: string
  /** Trọng số, tổng 100 */
  weight: number
  done: boolean
  /** Việc cần làm khi chưa xong — câu người dùng đọc và làm theo được */
  todo: string
  /** Nơi cần tới để làm việc đó, dạng JSON Pointer */
  path: string
}

export interface Completeness {
  /** 0–100, làm tròn */
  percent: number
  parts: CompletenessPart[]
  /** Phần chưa xong, nặng nhất trước — dùng cho "việc nên làm tiếp" */
  missing: CompletenessPart[]
}

/** Tỉ lệ gạch đầu dòng có số liệu mà từ đó coi là "đã có sức nặng". */
const METRIC_RATIO = 0.3

/** Số kỹ năng tối thiểu để mục kỹ năng có ích với người đọc. */
const MIN_SKILLS = 5

export function profileCompleteness(profile: Profile): Completeness {
  const highlights = allHighlights(profile)
  const withNumber = highlights.filter((h) => containsNumber(h.text)).length
  const metricRatio = highlights.length === 0 ? 0 : withNumber / highlights.length

  const hasBody = (items: { highlights: string[] }[]): boolean =>
    items.some((x) => x.highlights.length > 0)

  const parts: CompletenessPart[] = [
    {
      key: 'contact',
      label: 'Thông tin liên hệ',
      weight: 10,
      done: Boolean(profile.basics.name) && Boolean(profile.basics.email || profile.basics.phone),
      todo: 'Thêm tên và một cách liên hệ',
      path: '/basics',
    },
    {
      key: 'introduce',
      label: 'Giới thiệu bản thân',
      weight: 15,
      done: Boolean(profile.basics.introduce?.trim()),
      todo: 'Viết vài dòng giới thiệu bản thân',
      path: '/basics/introduce',
    },
    {
      // Kinh nghiệm HOẶC dự án — sinh viên chưa đi làm không vì thế mà bị trừ
      // điểm. Với họ, dự án mới là phần nhà tuyển dụng đọc kỹ (BR-05.2).
      key: 'experience',
      label: 'Kinh nghiệm hoặc dự án',
      weight: 30,
      done: hasBody(profile.work) || hasBody(profile.projects),
      todo: 'Thêm một kinh nghiệm hoặc dự án, kèm việc bạn đã làm',
      path: profile.work.length > 0 ? '/work' : '/projects',
    },
    {
      key: 'education',
      label: 'Học vấn',
      weight: 15,
      done: profile.education.length > 0,
      todo: 'Thêm trường và ngành học',
      path: '/education',
    },
    {
      key: 'skills',
      label: 'Kỹ năng',
      weight: 15,
      done: profile.skills.length >= MIN_SKILLS,
      todo: `Liệt kê ít nhất ${MIN_SKILLS} kỹ năng`,
      path: '/skills',
    },
    {
      key: 'metrics',
      label: 'Gạch đầu dòng có số liệu',
      weight: 15,
      done: metricRatio >= METRIC_RATIO,
      todo: 'Thêm số liệu vào các gạch đầu dòng — con số là thứ nhà tuyển dụng nhớ',
      path: profile.work.length > 0 ? '/work' : '/projects',
    },
  ]

  const earned = parts.filter((p) => p.done).reduce((s, p) => s + p.weight, 0)

  return {
    percent: Math.round(earned),
    parts,
    // Nặng nhất trước: sửa phần 30% đáng làm hơn phần 10%
    missing: parts.filter((p) => !p.done).sort((a, b) => b.weight - a.weight),
  }
}
