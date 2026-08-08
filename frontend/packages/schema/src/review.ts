import type { Profile } from './profile.js'

/**
 * Đơn vị rà soát của UC-22 — dùng CHUNG giữa API và UI.
 *
 * Vì sao ở `@hr/schema` chứ không ở component: nút "Tiếp" bị khoá cho tới khi
 * mọi mục được xác nhận (BR-22.1), và điều kiện đó phải được kiểm ở CẢ HAI
 * phía. Hai danh sách mục riêng biệt sẽ lệch nhau, và khi lệch thì hoặc user
 * bị khoá vĩnh viễn, hoặc lọt vào `/builder` với hồ sơ chưa rà soát.
 */

export type ReviewKind =
  | 'basics'
  | 'education'
  | 'work'
  | 'projects'
  | 'skills'
  | 'activities'
  | 'certifications'
  | 'languages'

export interface ReviewField {
  /** JSON Pointer tới field — khớp với khoá của `_meta.verified` */
  path: string
  label: string
  value: string
  /** Field trống: user cần điền, nhưng không chặn nút "Tiếp" */
  empty: boolean
}

export interface ReviewItem {
  kind: ReviewKind
  /** JSON Pointer tới cả mục con — đơn vị mà user bấm "Đúng rồi" */
  path: string
  title: string
  fields: ReviewField[]
}

export const REVIEW_LABELS: Record<ReviewKind, string> = {
  basics: 'Thông tin cá nhân',
  education: 'Học vấn',
  work: 'Kinh nghiệm',
  projects: 'Dự án',
  skills: 'Kỹ năng',
  activities: 'Hoạt động',
  certifications: 'Chứng chỉ',
  languages: 'Ngoại ngữ',
}

/** JSON Pointer escape — `~` → `~0`, `/` → `~1` (RFC 6901). */
function esc(s: string): string {
  return s.replace(/~/g, '~0').replace(/\//g, '~1')
}

function f(path: string, label: string, value: unknown): ReviewField {
  const v =
    value === undefined || value === null
      ? ''
      : Array.isArray(value)
        ? value.join(', ')
        : String(value)
  return { path, label, value: v, empty: v.trim() === '' }
}

/**
 * Dựng danh sách mục cần rà soát từ Profile.
 *
 * Hàm THUẦN, không chạm DB — nhờ vậy test được, và server lẫn client tính ra
 * cùng một kết quả.
 */
export function buildReviewItems(profile: Profile): ReviewItem[] {
  const items: ReviewItem[] = []
  const b = profile.basics

  // Thông tin cá nhân luôn có, kể cả khi trống: PII phải hiện ra để user soát
  // (BR-22.3) — đây thường là chỗ đọc sai nhiều nhất.
  items.push({
    kind: 'basics',
    path: '/basics',
    title: b.name || 'Thông tin cá nhân',
    fields: [
      f('/basics/name', 'Họ tên', b.name),
      f('/basics/headline', 'Chức danh', b.headline),
      f('/basics/email', 'Email', b.email),
      f('/basics/phone', 'Điện thoại', b.phone),
      f('/basics/location', 'Địa điểm', b.location),
    ],
  })

  profile.education.forEach((e, i) => {
    items.push({
      kind: 'education',
      path: `/education/${i}`,
      title: e.school || `Học vấn ${i + 1}`,
      fields: [
        f(`/education/${i}/school`, 'Trường', e.school),
        f(`/education/${i}/degree`, 'Bằng cấp', e.degree),
        f(`/education/${i}/major`, 'Ngành', e.major),
        f(`/education/${i}/gpa`, 'GPA', e.gpa),
      ],
    })
  })

  profile.work.forEach((w, i) => {
    items.push({
      kind: 'work',
      path: `/work/${i}`,
      title: `${w.role || 'Vị trí'} — ${w.org || ''}`.trim(),
      fields: [
        f(`/work/${i}/org`, 'Công ty', w.org),
        f(`/work/${i}/role`, 'Vị trí', w.role),
        f(`/work/${i}/highlights`, 'Mô tả', w.highlights),
      ],
    })
  })

  profile.projects.forEach((p, i) => {
    items.push({
      kind: 'projects',
      path: `/projects/${i}`,
      title: p.name || `Dự án ${i + 1}`,
      fields: [
        f(`/projects/${i}/name`, 'Tên dự án', p.name),
        f(`/projects/${i}/tech`, 'Công nghệ', p.tech),
        f(`/projects/${i}/highlights`, 'Mô tả', p.highlights),
      ],
    })
  })

  // Kỹ năng gộp thành MỘT mục: 44 kỹ năng thành 44 lần bấm "Đúng rồi" thì
  // không ai rà soát tới cuối — họ sẽ bấm bừa, và màn hình mất hết ý nghĩa.
  if (profile.skills.length > 0) {
    items.push({
      kind: 'skills',
      path: '/skills',
      title: `Kỹ năng (${profile.skills.length})`,
      fields: [f('/skills', 'Danh sách', profile.skills.map((s) => s.name))],
    })
  }

  profile.certifications.forEach((c, i) => {
    items.push({
      kind: 'certifications',
      path: `/certifications/${i}`,
      title: c.name || `Chứng chỉ ${i + 1}`,
      fields: [
        f(`/certifications/${i}/name`, 'Tên', c.name),
        f(`/certifications/${i}/issuer`, 'Nơi cấp', c.issuer),
        f(`/certifications/${i}/date`, 'Ngày', c.date),
      ],
    })
  })

  profile.activities.forEach((a, i) => {
    items.push({
      kind: 'activities',
      path: `/activities/${i}`,
      title: a.name || `Hoạt động ${i + 1}`,
      fields: [
        f(`/activities/${i}/name`, 'Tên', a.name),
        f(`/activities/${i}/role`, 'Vai trò', a.role),
        f(`/activities/${i}/highlights`, 'Mô tả', a.highlights),
      ],
    })
  })

  if (profile.languages.length > 0) {
    items.push({
      kind: 'languages',
      path: '/languages',
      title: `Ngoại ngữ (${profile.languages.length})`,
      fields: [
        f('/languages', 'Danh sách', profile.languages.map((l) => `${l.name} ${l.level ?? ''}`.trim())),
      ],
    })
  }

  return items
}

/**
 * BR-22.1: không có nút bỏ qua — mọi mục phải được xác nhận.
 *
 * Xác nhận theo `item.path` (cả mục), không theo từng field: user bấm "Đúng
 * rồi" một lần cho cả khối họ vừa đọc.
 */
export function reviewProgress(
  items: ReviewItem[],
  verified: Record<string, boolean>,
): { done: number; total: number; complete: boolean; pending: string[] } {
  const pending = items.filter((i) => verified[i.path] !== true).map((i) => i.path)
  return {
    done: items.length - pending.length,
    total: items.length,
    complete: pending.length === 0,
    pending,
  }
}

export { esc as escapePointer }
