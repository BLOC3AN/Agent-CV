import type { Profile, JDRequirements } from '@hr/schema'
import { containsPhrase, normalize } from './normalize.js'
import type { SkillHit, SkillTaxonomy } from './taxonomy.js'

/**
 * Lớp 1 — khớp từ khoá / ATS. TDD §8.2, THUẦN CODE.
 *
 * Vì sao điểm tính bằng code chứ không nhờ LLM (quyết định D3):
 *   · deterministic — cùng CV + cùng JD luôn ra cùng điểm, giải thích được
 *   · nhanh — ~2 giây thay vì ~70 giây, đủ để hiện ngay màn hình kết quả
 *   · test được — không cần model chạy để biết logic đúng hay sai
 * LLM chỉ diễn giải khoảng trống, không chấm điểm.
 */

export interface RequirementMatch {
  /** Yêu cầu như JD viết ra — hiển thị nguyên văn cho user */
  requirement: string
  canonical: string | null
  matched: boolean
  /** Khớp qua kỹ năng con: JD cần React, CV ghi Next.js */
  viaDescendant: string | null
  /** Nơi trong CV chứng minh — rỗng khi không khớp */
  evidence: { path: string; excerpt: string }[]
  weight: number
}

export interface KeywordResult {
  /** 0-100 */
  score: number
  /**
   * Điểm từng thành phần. `null` = lớp đó không có yêu cầu nào nên bị BỎ QUA
   * khỏi điểm tổng — khác hẳn với 0 điểm (có yêu cầu nhưng không đáp ứng).
   */
  parts: { hard: number | null; soft: number | null; ats: number | null }
  /**
   * JD không nêu yêu cầu nào — điểm KHÔNG có ý nghĩa.
   *
   * Vì sao phải tách ra thay vì chấm 0 hoặc 100: một JD parse hỏng và một JD
   * thật sự không đòi kỹ năng nào cho ra cùng đầu vào. Chấm 100 thì lỗi parse
   * biến thành "hồ sơ hoàn hảo"; chấm 0 thì JD viết sơ sài làm ứng viên hoảng.
   * Cả hai đều là nói dối. Đúng nhất là nói "chưa đọc được yêu cầu".
   */
  noRequirements: boolean
  /**
   * JD không nêu kỹ năng cứng nào — điểm chỉ mang tính tham khảo.
   *
   * JD-04 trong bộ eval là ca như vậy (cố tình mơ hồ). UI phải nói rõ, nếu
   * không user tưởng mình hợp 83% với một tin tuyển dụng chẳng đòi hỏi gì.
   */
  noHardRequirements: boolean
  hardSkills: RequirementMatch[]
  softSkills: RequirementMatch[]
  /** Từ khoá ATS trong JD mà CV không có — dùng nguyên văn của JD */
  missingAtsKeywords: string[]
  matchedAtsKeywords: string[]
  /** Kỹ năng CV có mà JD không hỏi — không trừ điểm, chỉ để tư vấn */
  extraSkills: SkillHit[]
}

/** Một đoạn text của CV kèm JSON Pointer — cần để trỏ bằng chứng về đúng chỗ. */
export interface ProfileChunk {
  path: string
  text: string
}

/**
 * Rải Profile thành các đoạn có địa chỉ.
 *
 * Vì sao cần `path`: báo cáo phải nói "khớp React ← Dự án 1" chứ không phải
 * "khớp React ← đâu đó trong CV". Không có địa chỉ thì user không kiểm chứng
 * được, và nút "Sửa giúp tôi" không biết sửa chỗ nào.
 */
export function chunkProfile(profile: Profile): ProfileChunk[] {
  const out: ProfileChunk[] = []
  const push = (path: string, text: unknown): void => {
    const s = Array.isArray(text) ? text.join(' · ') : String(text ?? '')
    if (s.trim()) out.push({ path, text: s })
  }

  push('/basics/headline', profile.basics.headline)
  push('/basics/summary', profile.basics.summary)

  profile.skills.forEach((s, i) => push(`/skills/${i}/name`, s.name))
  profile.languages.forEach((l, i) => push(`/languages/${i}`, `${l.name} ${l.level ?? ''}`))

  profile.work.forEach((w, i) => {
    push(`/work/${i}/role`, w.role)
    w.highlights.forEach((h, j) => push(`/work/${i}/highlights/${j}`, h))
  })
  profile.projects.forEach((p, i) => {
    push(`/projects/${i}/name`, p.name)
    push(`/projects/${i}/tech`, p.tech)
    p.highlights.forEach((h, j) => push(`/projects/${i}/highlights/${j}`, h))
  })
  profile.education.forEach((e, i) => {
    push(`/education/${i}`, [e.school, e.degree, e.major].filter(Boolean).join(' '))
    e.highlights.forEach((h, j) => push(`/education/${i}/highlights/${j}`, h))
  })
  profile.certifications.forEach((c, i) =>
    push(`/certifications/${i}`, [c.name, c.issuer].filter(Boolean).join(' ')),
  )
  profile.activities.forEach((a, i) => {
    push(`/activities/${i}`, [a.name, a.role].filter(Boolean).join(' '))
    a.highlights.forEach((h, j) => push(`/activities/${i}/highlights/${j}`, h))
  })

  return out
}

/** Chỉ mục kỹ năng của CV: canonical → nơi nó xuất hiện. */
function indexProfileSkills(
  chunks: ProfileChunk[],
  tax: SkillTaxonomy,
): Map<string, ProfileChunk[]> {
  const index = new Map<string, ProfileChunk[]>()
  for (const chunk of chunks) {
    for (const hit of tax.extract(chunk.text)) {
      const list = index.get(hit.canonical) ?? []
      list.push(chunk)
      index.set(hit.canonical, list)
    }
  }
  return index
}

function excerpt(s: string, max = 120): string {
  const t = s.trim()
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`
}

/**
 * Một yêu cầu của JD có được CV đáp ứng không.
 *
 * Ba đường khớp, xếp theo độ tin cậy giảm dần:
 *   1. đúng kỹ năng đó
 *   2. một kỹ năng CON của nó (JD cần React, CV ghi Next.js)
 *   3. khớp chuỗi thô — cho yêu cầu chưa có trong phân loại ("SAP", "Odoo")
 */
function matchOne(
  requirement: string,
  tax: SkillTaxonomy,
  index: Map<string, ProfileChunk[]>,
  chunks: ProfileChunk[],
): RequirementMatch {
  const hit = tax.canonicalize(requirement)

  if (hit) {
    const direct = index.get(hit.canonical)
    if (direct?.length) {
      return {
        requirement,
        canonical: hit.canonical,
        matched: true,
        viaDescendant: null,
        evidence: direct.slice(0, 3).map((c) => ({ path: c.path, excerpt: excerpt(c.text) })),
        weight: hit.weight,
      }
    }

    // Kỹ năng nào trong CV có yêu cầu này làm TỔ TIÊN?
    for (const [canonical, where] of index) {
      if (tax.ancestors(canonical).includes(hit.canonical)) {
        return {
          requirement,
          canonical: hit.canonical,
          matched: true,
          viaDescendant: canonical,
          evidence: where.slice(0, 2).map((c) => ({ path: c.path, excerpt: excerpt(c.text) })),
          weight: hit.weight,
        }
      }
    }

    return {
      requirement,
      canonical: hit.canonical,
      matched: false,
      viaDescendant: null,
      evidence: [],
      weight: hit.weight,
    }
  }

  // Ngoài phân loại: khớp chuỗi theo ranh giới từ. Phân loại không bao giờ đầy
  // đủ, và bỏ qua yêu cầu lạ sẽ khiến JD ngành hẹp mất hết điểm.
  const needle = normalize(requirement)
  const found = needle
    ? chunks.filter((c) => containsPhrase(` ${normalize(c.text)} `, needle))
    : []

  return {
    requirement,
    canonical: null,
    matched: found.length > 0,
    viaDescendant: null,
    evidence: found.slice(0, 3).map((c) => ({ path: c.path, excerpt: excerpt(c.text) })),
    weight: 1,
  }
}

/** `null` = lớp này không có yêu cầu nào → KHÔNG tính vào điểm. */
function coverage(matches: RequirementMatch[]): number | null {
  if (matches.length === 0) return null
  const total = matches.reduce((s, m) => s + m.weight, 0)
  if (total === 0) return null
  const got = matches.reduce((s, m) => s + (m.matched ? m.weight : 0), 0)
  return Math.round((got / total) * 100)
}

/**
 * Trung bình có trọng số, BỎ QUA lớp không có yêu cầu.
 *
 * Cách cũ cho lớp rỗng 100 điểm ("không đòi gì thì không trừ ai"). Đo trên
 * JD-04 thật — một JD cố tình mơ hồ, không nêu kỹ năng cứng nào — cách đó cho
 * ra 83 điểm: lớp `hard` rỗng được 100 và kéo cả điểm tổng lên. Một JD không
 * nêu yêu cầu gì mà chấm "83% phù hợp" là con số vô nghĩa nhưng trông đáng tin.
 *
 * Bỏ hẳn lớp rỗng thì nó không giúp cũng không hại, và điểm chỉ phản ánh
 * những gì thật sự đo được.
 */
function weightedAverage(parts: [number | null, number][]): number {
  let sum = 0
  let w = 0
  for (const [value, weight] of parts) {
    if (value === null) continue
    sum += value * weight
    w += weight
  }
  return w === 0 ? 0 : Math.round(sum / w)
}

/**
 * Chấm lớp 1.
 *
 * `hardSkills` nặng gấp ba `softSkills`: kỹ năng cứng kiểm chứng được từ bằng
 * chứng trong CV, còn kỹ năng mềm thì CV nào cũng ghi "teamwork". Cho chúng
 * ngang nhau nghĩa là thưởng cho việc liệt kê tính từ.
 */
export function scoreKeyword(
  profile: Profile,
  jd: JDRequirements,
  tax: SkillTaxonomy,
): KeywordResult {
  const chunks = chunkProfile(profile)
  const index = indexProfileSkills(chunks, tax)

  const hardSkills = jd.hardSkills.map((r) => matchOne(r, tax, index, chunks))
  const softSkills = jd.softSkills.map((r) => matchOne(r, tax, index, chunks))

  // Từ khoá ATS so khớp NGUYÊN VĂN của JD: hệ ATS quét đúng chuỗi trong tin
  // tuyển dụng, nó không biết "ReactJS" và "React" là một.
  const haystack = ` ${chunks.map((c) => normalize(c.text)).join(' | ')} `
  const matchedAtsKeywords: string[] = []
  const missingAtsKeywords: string[] = []
  for (const kw of jd.atsKeywords) {
    const n = normalize(kw)
    if (n && containsPhrase(haystack, n)) matchedAtsKeywords.push(kw)
    else missingAtsKeywords.push(kw)
  }

  const required = new Set([...hardSkills, ...softSkills].map((m) => m.canonical).filter(Boolean))
  const extraSkills = [...index.keys()]
    .filter((c) => !required.has(c))
    .map((c) => {
      const e = tax.entry(c)!
      return { canonical: c, display: e.display, kind: e.kind, weight: e.weight, matchedAs: c }
    })

  const hard = coverage(hardSkills)
  const soft = coverage(softSkills)
  // `null` chứ không phải 100: JD không nêu từ khoá ATS nào thì lớp này không
  // đo được gì, phải bị bỏ qua chứ không được cộng điểm miễn phí.
  const ats =
    jd.atsKeywords.length === 0
      ? null
      : Math.round((matchedAtsKeywords.length / jd.atsKeywords.length) * 100)

  const noRequirements =
    jd.hardSkills.length === 0 && jd.softSkills.length === 0 && jd.atsKeywords.length === 0

  const score = weightedAverage([
    [hard, 0.6],
    [soft, 0.2],
    [ats, 0.2],
  ])

  return {
    score,
    parts: { hard, soft, ats },
    noRequirements,
    noHardRequirements: jd.hardSkills.length === 0,
    hardSkills,
    softSkills,
    missingAtsKeywords,
    matchedAtsKeywords,
    extraSkills,
  }
}
