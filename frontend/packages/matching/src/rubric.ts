import { z } from 'zod'
import type { Profile, Seniority } from '@hr/schema'
import { normalize } from './normalize.js'

/**
 * Lớp 3 — chấm theo RUBRIC của HR. TDD §8.2 lớp 3, §10.3.
 *
 * > "Rubric là dữ liệu, không phải văn bản. Nếu để rubric trôi trong kho vector,
 * >  bạn mất khả năng chấm điểm deterministic và model sẽ tùy hứng bỏ qua tiêu chí."
 *
 * Đây là lớp mang KINH NGHIỆM HR vào điểm số: "fresher cần ≥2 dự án", "≥30%
 * bullet có số liệu". Hai lớp trước chỉ đo mức khớp với JD; lớp này đo chất
 * lượng bản thân CV, và nó chạy được cả khi chưa có JD nào.
 */

// ── Lược đồ rubric (khớp `kb/seed/*.yaml`) ─────────────────────────────────

const CriterionSchema = z.object({
  id: z.string(),
  label: z.object({ vi: z.string(), en: z.string() }),
  type: z.enum(['count', 'ratio', 'page_count', 'required_fields', 'custom']),
  weight: z.number().min(0).max(1),
  path: z.string().optional(),
  matcher: z.enum(['contains_number', 'starts_with_action_verb']).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  fields: z.array(z.string()).default([]),
  recommended: z.array(z.string()).default([]),
  /** Mô tả bằng tiếng người cho `type: custom` — KHÔNG chấm tự động được */
  rule: z.string().optional(),
  advice_when_below: z.object({ vi: z.string(), en: z.string() }).optional(),
  advice_when_above: z.object({ vi: z.string(), en: z.string() }).optional(),
})

export const RubricSchema = z.object({
  industry: z.string(),
  role_family: z.string(),
  seniority: z.string(),
  criteria: z.array(CriterionSchema).min(1),
})

export type Criterion = z.infer<typeof CriterionSchema>
export type Rubric = z.infer<typeof RubricSchema>

// ── Kết quả ────────────────────────────────────────────────────────────────

export interface CriterionResult {
  id: string
  label: { vi: string; en: string }
  /** 0-100 */
  score: number
  weight: number
  passed: boolean
  /** Đo được gì — hiện cho user để họ hiểu vì sao bị trừ */
  actual: string
  expected: string
  advice: { vi: string; en: string } | null
  /**
   * `true` khi tiêu chí KHÔNG chấm tự động được (`type: custom`).
   * Nó bị LOẠI khỏi điểm, không phải cho điểm 0 — chấm bừa còn tệ hơn bỏ qua.
   */
  manual: boolean
}

export interface RubricResult {
  /** 0-100, hoặc `null` khi không có rubric nào áp dụng được */
  score: number | null
  rubricId: string | null
  criteria: CriterionResult[]
  /** Tiêu chí cần người đánh giá — hiện riêng, không trộn vào điểm */
  manualCriteria: CriterionResult[]
}

// ── Bộ dò ──────────────────────────────────────────────────────────────────

/**
 * Bullet có số liệu không.
 *
 * Không nhận mọi chữ số: "React 18", "Python 3" là tên phiên bản, không phải
 * thành tích. Đòi con số phải đi kèm ĐƠN VỊ hoặc ngữ cảnh định lượng.
 */
const NUMBER_SIGNALS =
  /\d+\s*(%|percent|phần trăm|người dùng|user|khách|bản ghi|record|request|req\/s|rps|qps|ms|giây|s\b|phút|giờ|ngày|tuần|tháng|năm|lần|dự án|thành viên|nhân sự|ticket|đơn|giao dịch|triệu|nghìn|tỷ|k\b|m\b|gb|tb|mb)/i

/** Số đứng riêng nhưng có động từ định lượng đi kèm — "giảm từ 800 xuống 120". */
const QUANT_VERB =
  /(tăng|giảm|rút ngắn|tiết kiệm|cải thiện|nâng|xử lý|phục vụ|quản lý|đạt|increase|reduce|improve|save|handle|serve|process|achiev)\w*[^.]{0,40}\d/i

export function containsNumber(text: string): boolean {
  return NUMBER_SIGNALS.test(text) || QUANT_VERB.test(text)
}

/**
 * Động từ hành động mở đầu bullet.
 *
 * Danh sách CHẶN quan trọng hơn danh sách nhận: HR quan tâm bullet KHÔNG bắt
 * đầu bằng "Chịu trách nhiệm", "Tham gia", "Được giao" — những cụm nói lên
 * người khác giao việc chứ không phải bạn làm ra kết quả.
 */
const WEAK_OPENERS =
  /^(chiu trach nhiem|tham gia|duoc giao|ho tro|phu trach|lam viec|responsible for|participated|assisted|involved in|helped|worked on|was assigned)/

export function startsWithActionVerb(text: string): boolean {
  const t = normalize(text)
  if (!t) return false
  if (WEAK_OPENERS.test(t)) return false
  // Bullet mở đầu bằng danh từ ("Hệ thống quản lý…") cũng không phải động từ
  // hành động, nhưng phân biệt từ loại tiếng Việt bằng regex là bất khả thi.
  // Nên chỉ chặn những mở đầu YẾU đã biết — bỏ sót còn hơn chặn nhầm.
  return true
}

// ── Trích dữ liệu từ Profile ───────────────────────────────────────────────

/** Mọi bullet trong CV, kèm đường dẫn — cần để trỏ chỗ cần sửa. */
export function allHighlights(p: Profile): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = []
  p.work.forEach((w, i) => w.highlights.forEach((h, j) => out.push({ path: `/work/${i}/highlights/${j}`, text: h })))
  p.projects.forEach((x, i) => x.highlights.forEach((h, j) => out.push({ path: `/projects/${i}/highlights/${j}`, text: h })))
  p.education.forEach((e, i) => e.highlights.forEach((h, j) => out.push({ path: `/education/${i}/highlights/${j}`, text: h })))
  p.activities.forEach((a, i) => a.highlights.forEach((h, j) => out.push({ path: `/activities/${i}/highlights/${j}`, text: h })))
  return out
}

/**
 * Đọc giá trị theo `path` kiểu JSONPath rút gọn của rubric.
 *
 * Chỉ hỗ trợ đúng những dạng có trong KB (`$.projects`, `$..highlights[*]`) —
 * không nhúng cả thư viện JSONPath cho ba mẫu cố định. Mẫu lạ trả `null` để
 * tiêu chí đó bị đánh dấu `manual` thay vì âm thầm chấm 0.
 */
function resolveCount(p: Profile, path: string): number | null {
  switch (path) {
    case '$.projects':
      return p.projects.length
    case '$.work':
      return p.work.length
    case '$.education':
      return p.education.length
    case '$.skills':
      return p.skills.length
    case '$.certifications':
      return p.certifications.length
    case '$..highlights[*]':
      return allHighlights(p).length
    default:
      return null
  }
}

/** Field có giá trị thật không — theo `basics.email` kiểu chấm. */
function hasField(p: Profile, dotted: string): boolean {
  // `basics.links[?(@.label=='GitHub')]` — chỉ cần biết CÓ link nào nhãn đó
  const linkMatch = /^basics\.links\[\?\(@\.label=='(.+)'\)\]$/.exec(dotted)
  if (linkMatch) {
    const label = linkMatch[1]!.toLowerCase()
    return p.basics.links.some((l) => l.label.toLowerCase().includes(label))
  }

  let node: unknown = p
  for (const key of dotted.split('.')) {
    if (node === null || typeof node !== 'object') return false
    node = (node as Record<string, unknown>)[key]
  }
  return node !== undefined && node !== null && String(node).trim() !== ''
}

/**
 * Ước lượng số trang CV.
 *
 * Không render thật: rubric chạy ở lớp chấm điểm, không được phụ thuộc
 * Playwright (nó nằm ở worker và tốn hàng trăm MB). Ước lượng theo tổng lượng
 * chữ — đủ để bắt ca "fresher viết 3 trang", vốn là điều rubric quan tâm.
 */
export function estimatePages(p: Profile): number {
  const chars =
    (p.basics.introduce?.length ?? 0) +
    allHighlights(p).reduce((s, h) => s + h.text.length, 0) +
    p.work.length * 60 +
    p.projects.length * 60 +
    p.education.length * 50 +
    p.skills.length * 12
  // ~2.600 ký tự lấp đầy một trang A4 với mẫu CV thường dùng
  return Math.max(1, Math.ceil(chars / 2_600))
}

// ── Chấm ───────────────────────────────────────────────────────────────────

function ratioOf(p: Profile, c: Criterion): { value: number; total: number } {
  const items = allHighlights(p)
  if (items.length === 0) return { value: 0, total: 0 }
  const fn = c.matcher === 'contains_number' ? containsNumber : startsWithActionVerb
  const hit = items.filter((i) => fn(i.text)).length
  return { value: hit / items.length, total: items.length }
}

function scoreCriterion(p: Profile, c: Criterion): CriterionResult {
  const base = {
    id: c.id,
    label: c.label,
    weight: c.weight,
    advice: null as CriterionResult['advice'],
    manual: false,
  }

  // `type: custom` mô tả bằng tiếng người ("có bullet thể hiện tự đề xuất").
  // Chấm tự động là đoán mò — tách ra cho người đánh giá, KHÔNG cho điểm 0.
  if (c.type === 'custom') {
    return {
      ...base,
      score: 0,
      passed: false,
      manual: true,
      actual: 'cần người đánh giá',
      expected: c.rule ?? '—',
      advice: c.advice_when_below ?? null,
    }
  }

  if (c.type === 'count') {
    const n = c.path ? resolveCount(p, c.path) : null
    if (n === null) {
      return { ...base, score: 0, passed: false, manual: true, actual: `path lạ: ${c.path}`, expected: '—' }
    }
    const min = c.min ?? 0
    const passed = n >= min
    // Điểm theo tỉ lệ, không phải đạt/không đạt: có 1/2 dự án tốt hơn 0/2, và
    // thang nhị phân làm user không thấy mình đang tiến bộ
    const score = min === 0 ? 100 : Math.min(100, Math.round((n / min) * 100))
    return {
      ...base,
      score,
      passed,
      actual: `${n}`,
      expected: `≥ ${min}`,
      advice: passed ? null : (c.advice_when_below ?? null),
    }
  }

  if (c.type === 'ratio') {
    const { value, total } = ratioOf(p, c)
    if (total === 0) {
      return {
        ...base,
        score: 0,
        passed: false,
        actual: 'không có gạch đầu dòng nào',
        expected: `≥ ${Math.round((c.min ?? 0) * 100)}%`,
        advice: c.advice_when_below ?? null,
      }
    }
    const min = c.min ?? 0
    const passed = value >= min
    const score = min === 0 ? 100 : Math.min(100, Math.round((value / min) * 100))
    return {
      ...base,
      score,
      passed,
      actual: `${Math.round(value * 100)}% (${Math.round(value * total)}/${total})`,
      expected: `≥ ${Math.round(min * 100)}%`,
      advice: passed ? null : (c.advice_when_below ?? null),
    }
  }

  if (c.type === 'page_count') {
    const pages = estimatePages(p)
    const max = c.max ?? 99
    const passed = pages <= max
    return {
      ...base,
      score: passed ? 100 : Math.max(0, 100 - (pages - max) * 40),
      passed,
      actual: `~${pages} trang`,
      expected: `≤ ${max} trang`,
      advice: passed ? null : (c.advice_when_above ?? null),
    }
  }

  // required_fields
  const required = c.fields
  const got = required.filter((f) => hasField(p, f))
  const recommendedGot = c.recommended.filter((f) => hasField(p, f))
  const passed = got.length === required.length

  // Field bắt buộc chiếm 80%, khuyến nghị 20% — thiếu GitHub không nghiêm trọng
  // bằng thiếu email, nhưng vẫn phải phản ánh vào điểm
  const reqScore = required.length === 0 ? 100 : (got.length / required.length) * 100
  const recScore = c.recommended.length === 0 ? 100 : (recommendedGot.length / c.recommended.length) * 100
  const score = Math.round(reqScore * 0.8 + recScore * 0.2)

  const missing = [...required.filter((f) => !hasField(p, f)), ...c.recommended.filter((f) => !hasField(p, f))]
  return {
    ...base,
    score,
    passed,
    actual: missing.length ? `thiếu: ${missing.join(', ')}` : 'đầy đủ',
    expected: required.join(', ') || '—',
    advice: score === 100 ? null : (c.advice_when_below ?? null),
  }
}

/**
 * Chọn rubric phù hợp nhất.
 *
 * Khớp chính xác `(industry, role_family, seniority)` trước; không có thì hạ
 * dần: cùng ngành + cùng cấp bậc, rồi cùng ngành. KHÔNG lấy bừa rubric đầu
 * tiên — chấm fresher bằng thước của senior là bất công có hệ thống.
 */
export function selectRubric(
  rubrics: Rubric[],
  ctx: { industry: string; roleFamily: string; seniority: Seniority | string },
): Rubric | null {
  const exact = rubrics.find(
    (r) =>
      r.industry === ctx.industry &&
      r.role_family === ctx.roleFamily &&
      r.seniority === ctx.seniority,
  )
  if (exact) return exact

  const bySeniority = rubrics.find(
    (r) => r.industry === ctx.industry && r.seniority === ctx.seniority,
  )
  if (bySeniority) return bySeniority

  return rubrics.find((r) => r.industry === ctx.industry) ?? null
}

export function scoreRubric(profile: Profile, rubric: Rubric | null): RubricResult {
  if (!rubric) {
    return { score: null, rubricId: null, criteria: [], manualCriteria: [] }
  }

  const all = rubric.criteria.map((c) => scoreCriterion(profile, c))
  const auto = all.filter((c) => !c.manual)
  const manual = all.filter((c) => c.manual)

  // Chia lại theo trọng số của phần CHẤM ĐƯỢC. Giữ nguyên mẫu số gốc sẽ khiến
  // một CV hoàn hảo vẫn mất điểm chỉ vì rubric có tiêu chí cần người đánh giá.
  const totalWeight = auto.reduce((s, c) => s + c.weight, 0)
  const score =
    totalWeight === 0
      ? null
      : Math.round(auto.reduce((s, c) => s + c.score * c.weight, 0) / totalWeight)

  return {
    score,
    rubricId: `${rubric.industry}/${rubric.role_family}/${rubric.seniority}`,
    criteria: auto,
    manualCriteria: manual,
  }
}
