import type { Language, Profile } from '@hr/schema'
import { scoreRubric, selectRubric, type CriterionResult, type Rubric } from './rubric.js'

/**
 * Sức khoẻ CV — UC-04, PRODUCT §5.3. Chấm KHÔNG cần tin tuyển dụng.
 *
 * ── Vì sao tách khỏi `analyze()` ──
 * `analyze()` trả lời *"tôi có hợp việc này không"* và bắt buộc phải có JD.
 * Nhưng câu hỏi của nhóm người dùng đông nhất là *"CV tôi có ổn không"* — họ
 * chưa nhắm việc cụ thể nào. Bắt họ dán một tin tuyển dụng vào chỉ để biết CV
 * mình dở chỗ nào là hỏi một câu không liên quan tới thứ họ đang cần.
 *
 * Mọi con số ở đây đến từ `scoreRubric()`, tức từ tiêu chí do HR thật viết
 * trong KB. Cấm vẽ thanh bằng số bịa (BR-04.1) — dự án đã trả giá cho việc đo
 * sai thứ (TDD §8.2).
 */

export interface HealthBar {
  id: string
  label: string
  /** 0–100 */
  score: number
  /** Nhãn định tính, thứ người dùng đọc trước con số */
  verdict: 'good' | 'ok' | 'weak'
  /** Đo được gì — để người dùng hiểu vì sao bị trừ */
  actual: string
  expected: string
}

export interface HealthFix {
  id: string
  /** Việc cần làm, lấy từ lời khuyên của HR trong KB */
  advice: string
  /** Nơi cần tới, JSON Pointer — bấm vào là tới đúng chỗ (BR-04.2) */
  path: string
  /** Nhãn mục để hiện trên nút */
  section: string
}

export interface CvHealth {
  /** `false` khi không rubric nào áp dụng được — KHÔNG vẽ thanh rỗng (BR-P.4) */
  scored: boolean
  /** 0–100, `null` khi chưa chấm được */
  overall: number | null
  rubricId: string | null
  bars: HealthBar[]
  /** Điểm MẠNH, nêu trước điểm yếu (BR-04.4) */
  strengths: HealthBar[]
  /** Tối đa 3 việc nên sửa trước (BR-04.3) */
  fixes: HealthFix[]
  /** Tiêu chí cần người đánh giá — hiện riêng, không trộn vào điểm */
  manual: CriterionResult[]
}

/** Ngưỡng đọc thành lời. Dưới 50 là "yếu" — đủ thấp để đáng sửa trước. */
function verdictOf(score: number): HealthBar['verdict'] {
  if (score >= 75) return 'good'
  if (score >= 50) return 'ok'
  return 'weak'
}

/**
 * Tiêu chí → chỗ cần tới trong hồ sơ.
 *
 * Tiêu chí trong KB dùng đường dẫn kiểu JSONPath (`$.projects`,
 * `$..highlights[*]`); giao diện cần JSON Pointer. Chỗ nào suy được thì suy,
 * chỗ nào không thì trỏ về mục hợp lý nhất — KHÔNG bịa một đường dẫn không tồn
 * tại, vì bấm vào sẽ tới hư không.
 */
function targetOf(id: string, profile: Profile): { path: string; section: string } {
  if (id.includes('project')) return { path: '/projects', section: 'Dự án' }
  if (id.includes('edu') || id.includes('gpa')) return { path: '/education', section: 'Học vấn' }
  if (id.includes('skill') || id.includes('tech')) return { path: '/skills', section: 'Kỹ năng' }
  if (id.includes('summary') || id.includes('introduce') || id.includes('headline')) {
    return { path: '/basics/introduce', section: 'Giới thiệu' }
  }
  // Các tiêu chí về gạch đầu dòng (số liệu, động từ hành động) rơi vào mục nào
  // ĐANG CÓ nội dung — trỏ vào mục rỗng thì người dùng tới nơi không có gì để sửa.
  if (profile.work.some((w) => w.highlights.length > 0)) {
    return { path: '/work', section: 'Kinh nghiệm' }
  }
  if (profile.projects.some((p) => p.highlights.length > 0)) {
    return { path: '/projects', section: 'Dự án' }
  }
  return { path: '/work', section: 'Kinh nghiệm' }
}

export interface HealthInput {
  profile: Profile
  rubrics: Rubric[]
  /** Ngữ cảnh chọn rubric; mặc định là fresher ngành phần mềm */
  ctx?: { industry: string; roleFamily: string; seniority: string }
  language?: Language
}

export function cvHealth(input: HealthInput): CvHealth {
  const lang = input.language ?? input.profile.language
  const ctx = input.ctx ?? {
    industry: 'it_software',
    roleFamily: 'all',
    seniority: 'fresher',
  }

  const rubric = selectRubric(input.rubrics, ctx)
  const r = scoreRubric(input.profile, rubric)

  if (r.score === null) {
    // Không chấm được thì NÓI THẲNG, không hiện thanh rỗng giả vờ đã đo (BR-P.4)
    return {
      scored: false,
      overall: null,
      rubricId: null,
      bars: [],
      strengths: [],
      fixes: [],
      manual: r.manualCriteria,
    }
  }

  const bars: HealthBar[] = r.criteria
    .filter((c) => !c.manual)
    .map((c) => ({
      id: c.id,
      label: lang === 'en' ? c.label.en : c.label.vi,
      score: c.score,
      verdict: verdictOf(c.score),
      actual: c.actual,
      expected: c.expected,
    }))

  const fixes: HealthFix[] = r.criteria
    .filter((c) => !c.manual && !c.passed && c.advice)
    // Nặng nhất trước: sửa tiêu chí 25% đáng làm hơn tiêu chí 5%
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((c) => {
      const t = targetOf(c.id, input.profile)
      return {
        id: c.id,
        advice: lang === 'en' ? c.advice!.en : c.advice!.vi,
        path: t.path,
        section: t.section,
      }
    })

  return {
    scored: true,
    overall: r.score,
    rubricId: r.rubricId,
    bars,
    // Nêu điểm mạnh trước điểm yếu (BR-04.4): cùng một sự thật, hai cách nói
    // cho hai kết cục khác nhau
    strengths: bars.filter((b) => b.verdict === 'good').slice(0, 3),
    fixes,
    manual: r.manualCriteria,
  }
}
