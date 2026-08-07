import type { JDRequirements, MatchResult, Profile } from '@hr/schema'
import { chunkProfile, scoreKeyword, type KeywordResult } from './keyword.js'
import { scoreSemantic, type EmbedFn, type RerankFn, type SemanticResult } from './semantic.js'
import { scoreRubric, selectRubric, type Rubric, type RubricResult } from './rubric.js'
import type { SkillTaxonomy } from './taxonomy.js'

/**
 * Ghép ba lớp thành MỘT điểm — TDD §8.2, quyết định D3/A4.
 *
 * Toàn bộ hàm này THUẦN CODE. Nó chạy xong trong ~2 giây, đủ để hiện điểm ngay
 * cho user trong khi phần tư vấn bằng LLM (`gap_analysis`) còn đang chạy 70
 * giây phía sau (FRONTEND §5.1).
 *
 * Ba lớp đo ba thứ KHÁC NHAU, không phải ba cách đo cùng một thứ:
 *   · keyword  — JD hỏi X, CV có nhắc X không
 *   · semantic — JD hỏi X, CV có thể hiện X bằng cách nói khác không
 *   · rubric   — bản thân CV có tốt không, độc lập với JD
 */

export interface AnalyzeInput {
  profile: Profile
  jd: JDRequirements
  taxonomy: SkillTaxonomy
  rubrics: Rubric[]
  embedder?: EmbedFn | null
  reranker?: RerankFn | null
  useRerank?: boolean
}

export interface AnalyzeResult {
  match: MatchResult
  /** Chi tiết từng lớp — màn hình báo cáo cần để giải thích con số */
  layers: {
    keyword: KeywordResult
    semantic: SemanticResult
    rubric: RubricResult
  }
}

/**
 * Trọng số của năm thanh. `skills` nặng nhất vì đó là thứ nhà tuyển dụng đọc
 * đầu tiên, và cũng là thứ ứng viên sửa được nhanh nhất.
 */
const WEIGHTS = {
  skills: 0.4,
  keywords: 0.15,
  experience: 0.1,
  education: 0.05,
  rubric: 0.3,
} as const

/**
 * Điểm tổng là trung bình có trọng số của CHÍNH NĂM THANH mà giao diện hiện.
 *
 * Vì sao không lấy trực tiếp ba lớp: lớp ngữ nghĩa bị tính HAI LẦN. Nó vừa
 * nâng `skills` (cứu những yêu cầu diễn đạt khác chữ), vừa là một số hạng
 * riêng. Đo thật trên CV Fullstack + JD-01: bật embedder cho 79 điểm, TẮT
 * embedder cho 89 — dịch vụ chạy tốt lại làm điểm thấp đi. Người dùng gặp
 * điểm nhảy tuỳ lúc hạ tầng sống hay chết.
 *
 * Lớp ngữ nghĩa nay chỉ ảnh hưởng qua `skills`. Nó CHỈ CÓ THỂ nâng, không thể
 * hạ — đúng vai trò của nó: tìm thêm bằng chứng, không phải một khía cạnh
 * riêng của hồ sơ.
 *
 * Lợi ích kèm theo: điểm tổng suy ra được từ các thanh hiện trên màn hình.
 * User nhìn `skills 0` là hiểu ngay vì sao tổng thấp, không phải tin suông.
 *
 * `rubric: 0.3` là con số KB đã ghi:
 *   > "Điểm rubric chiếm 30% điểm tổng; 70% còn lại từ độ khớp JD."
 *
 * HỆ QUẢ phải biết: CV viết rất tốt nhưng SAI NGÀNH vẫn được khoảng 30 điểm —
 * rubric đo chất lượng bản thân CV, không đo độ hợp việc. Đo thật: CV dịch vụ
 * khách hàng trên JD Fullstack được 31, `skills` bằng 0.
 */

/** Trung bình có trọng số, BỎ QUA lớp `null` — xem TDD §8.2.1. */
function combine(parts: [number | null, number][]): number {
  let sum = 0
  let w = 0
  for (const [v, weight] of parts) {
    if (v === null) continue
    sum += v * weight
    w += weight
  }
  return w === 0 ? 0 : Math.round(sum / w)
}

/**
 * Năm thanh trong báo cáo — mỗi thanh đo ĐÚNG thứ nó ghi tên.
 *
 * Bản đầu nhét ba lớp vào năm ô: `experience` hiện điểm ngữ nghĩa, `education`
 * hiện điểm kinh nghiệm làm việc. Giao diện vẫn vẽ ra năm thanh trông rất hợp
 * lý — và nói dối ở hai thanh. Người dùng đọc "Học vấn 100" rồi tưởng bằng cấp
 * của mình hợp vị trí, trong khi con số đó nói về số năm đi làm.
 *
 * Lớp ngữ nghĩa KHÔNG có thanh riêng: nó không phải một khía cạnh của hồ sơ,
 * nó là cách tìm bằng chứng cho `skills`. Đóng góp của nó nằm ở những yêu cầu
 * được nó cứu khỏi bị xếp "thiếu".
 */
function buildBreakdown(
  profile: Profile,
  jd: JDRequirements,
  keyword: KeywordResult,
  semantic: SemanticResult,
  rubric: RubricResult,
): MatchResult['breakdown'] {
  const hardTotal = keyword.hardSkills.length
  const rescued = keyword.hardSkills.filter(
    (m) =>
      !m.matched &&
      semantic.matches.some(
        (s) =>
          s.requirement === m.requirement &&
          (s.strength === 'strong' || s.strength === 'moderate'),
      ),
  ).length
  const skills =
    hardTotal === 0
      ? (keyword.parts.hard ?? 0)
      : Math.round(
          ((keyword.hardSkills.filter((m) => m.matched).length + rescued) / hardTotal) * 100,
        )

  // Kinh nghiệm: JD đòi bao nhiêu năm so với thực tế trong CV. JD không nêu số
  // năm thì dùng tiêu chí kinh nghiệm của rubric.
  const experience = (() => {
    const need = jd.yearsRequired
    if (need !== null && need > 0) {
      return Math.min(100, Math.round((estimateYears(profile) / need) * 100))
    }
    const c = rubric.criteria.find((x) => x.id === 'work_experience')
    if (c) return c.score
    return profile.work.length > 0 ? 100 : 0
  })()

  // Học vấn: JD có đòi bằng cấp cụ thể thì đối chiếu, không thì chỉ xét CÓ/KHÔNG
  const education = (() => {
    if (profile.education.length === 0) return 0
    const want = jd.education?.trim().toLowerCase()
    if (!want) return 100
    const keyword0 = want.split(/\s+/)[0] ?? ''
    const has = profile.education.some((e) =>
      `${e.degree} ${e.major ?? ''} ${e.school}`.toLowerCase().includes(keyword0),
    )
    return has ? 100 : 60
  })()

  return {
    skills,
    experience,
    education,
    keywords: keyword.parts.ats ?? 0,
    rubric: rubric.score ?? 0,
  }
}

/**
 * Ước lượng số năm kinh nghiệm từ mốc thời gian trong CV.
 *
 * Chỉ đọc NĂM: CV viết thời gian đủ kiểu ("6/2023 - 12/2023", "2021–nay",
 * "Jun 2023 - Present"). Bắt cả tháng cho chính xác hơn không đáng — sai số
 * vài tháng không đổi kết luận, còn parse sai định dạng thì đổi hẳn.
 */
export function estimateYears(profile: Profile): number {
  const years = new Set<number>()
  const now = new Date().getFullYear()

  for (const w of profile.work) {
    const period = `${w.startDate ?? ''} ${w.endDate ?? ''}`
    const found = [...period.matchAll(/(?:19|20)\d{2}/g)].map((m) => Number(m[0]))
    const isPresent = /nay|hiện tại|present|current/i.test(period)
    const from = found.length ? Math.min(...found) : null
    const to = isPresent ? now : found.length ? Math.max(...found) : null
    if (from === null || to === null) continue
    for (let y = from; y <= Math.min(to, now); y++) years.add(y)
  }

  // Đếm số NĂM RIÊNG BIỆT, không cộng dồn từng công việc: làm hai nơi cùng lúc
  // không cho ra gấp đôi kinh nghiệm.
  return years.size
}

export async function analyze(input: AnalyzeInput): Promise<AnalyzeResult> {
  const { profile, jd, taxonomy, rubrics } = input

  const chunks = chunkProfile(profile)

  const keyword = scoreKeyword(profile, jd, taxonomy)

  const semantic = await scoreSemantic(
    chunks,
    jd,
    input.embedder ?? null,
    input.reranker ?? null,
    { rerank: input.useRerank ?? false },
  )

  const rubric = scoreRubric(
    profile,
    selectRubric(rubrics, {
      industry: 'it_software',
      roleFamily: jd.roleFamily,
      seniority: jd.seniority,
    }),
  )

  const breakdown = buildBreakdown(profile, jd, keyword, semantic, rubric)

  // Lớp nào KHÔNG đo được thì loại khỏi trung bình, không cho 0 cũng không cho
  // 100 (TDD §8.2.1). JD không nêu từ khoá ATS → thanh đó không tham gia.
  const overall = combine([
    [breakdown.skills, WEIGHTS.skills],
    [keyword.parts.ats === null ? null : breakdown.keywords, WEIGHTS.keywords],
    [breakdown.experience, WEIGHTS.experience],
    [breakdown.education, WEIGHTS.education],
    [rubric.score, WEIGHTS.rubric],
  ])

  // ── Danh sách khớp và khoảng trống ────────────────────────────────────
  const matched: MatchResult['matched'] = []
  const gaps: MatchResult['gaps'] = []

  for (const m of keyword.hardSkills) {
    if (m.matched) {
      matched.push({
        requirement: m.requirement,
        evidence: m.evidence.map((e) => ({ path: e.path, excerpt: e.excerpt, score: 1 })),
        strength: m.viaDescendant ? 'moderate' : 'strong',
      })
      continue
    }

    // Lớp keyword không thấy — hỏi lớp semantic trước khi kết luận là THIẾU.
    // Bỏ qua bước này thì CV viết "giảm 800ms xuống 120ms" vẫn bị báo thiếu
    // "tối ưu hiệu năng".
    const sem = semantic.matches.find((s) => s.requirement === m.requirement)
    if (sem && (sem.strength === 'strong' || sem.strength === 'moderate')) {
      matched.push({
        requirement: m.requirement,
        evidence: sem.evidence.map((e) => ({
          path: e.path,
          excerpt: e.excerpt,
          score: e.similarity,
        })),
        strength: 'moderate',
      })
      gaps.push({
        id: `implicit:${m.requirement}`,
        requirement: m.requirement,
        severity: 'medium',
        // CV có thể hiện, nhưng KHÔNG dùng đúng từ JD dùng → ATS sẽ loại
        reason: 'implicit',
        advice: null,
        kbRefs: [],
      })
      continue
    }

    gaps.push({
      id: `missing:${m.requirement}`,
      requirement: m.requirement,
      severity: 'high',
      reason: 'missing',
      advice: null,
      kbRefs: [],
    })
  }

  // Tiêu chí rubric không đạt cũng là khoảng trống — nhưng về CHẤT LƯỢNG CV,
  // không phải về độ khớp JD. Lời khuyên lấy sẵn từ KB, không cần LLM.
  for (const c of rubric.criteria.filter((x) => !x.passed)) {
    gaps.push({
      id: `rubric:${c.id}`,
      requirement: c.label.vi,
      severity: c.weight >= 0.25 ? 'high' : c.weight >= 0.15 ? 'medium' : 'low',
      reason: 'below_threshold',
      advice: c.advice?.vi ?? null,
      kbRefs: [],
    })
  }

  const match: MatchResult = {
    overall,
    breakdown,
    matched,
    gaps,
    missingAtsKeywords: keyword.missingAtsKeywords,
    degraded: semantic.degraded,
    degradedReason: semantic.degradedReason,
  }

  return { match, layers: { keyword, semantic, rubric } }
}
