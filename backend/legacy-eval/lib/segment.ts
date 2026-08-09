/**
 * Chia CV thành các mục theo tiêu đề — THUẦN CODE, không dùng LLM.
 *
 * Vì sao cần: model 4B parse chính xác từng mục riêng lẻ (3/3 lần đúng trên
 * đoạn EDUCATION cô lập) nhưng BỎ SÓT NGUYÊN MỤC khi đưa cả CV 3000 ký tự vào
 * một lượt. Đây là mất chú ý theo độ dài, không phải lỗi schema.
 *
 * TDD §6.4 bước 5 đã dự phòng đúng tình huống này: "chia nhỏ task, không cắt bừa".
 *
 * Làm bằng code chứ không bằng LLM vì: rẻ, deterministic, test được, và tiêu đề
 * mục trong CV là tín hiệu rất mạnh.
 */

export type SectionKind =
  | 'introduce'
  | 'education'
  | 'work'
  | 'projects'
  | 'skills'
  | 'activities'
  | 'certifications'
  | 'languages'
  | 'awards'
  | 'unknown'

export interface CvSection {
  kind: SectionKind
  heading: string
  body: string
}

/** Từ khoá tiêu đề — song ngữ, thứ tự quan trọng (khớp cụ thể trước) */
const HEADINGS: [SectionKind, RegExp][] = [
  ['introduce', /^(summary|profile|objective|about( me)?|introduction|giới thiệu|mục tiêu( nghề nghiệp)?|tóm tắt|sơ lược|bản thân)\b/i],
  ['education', /^(education|academic|qualifications?|học vấn|trình độ( học vấn)?|quá trình học tập|bằng cấp)\b/i],
  ['work', /^(work|experience|employment|professional|career|kinh nghiệm( làm việc)?|quá trình công tác|kinh nghiệm)\b/i],
  ['projects', /^(projects?|portfolio|dự án|sản phẩm|đồ án)\b/i],
  ['skills', /^(skills?|technical|technologies|competenc|expertise|kỹ năng|công nghệ|chuyên môn)\b/i],
  ['certifications', /^(certifications?|certificates?|licen[cs]es?|chứng chỉ|chứng nhận)\b/i],
  ['languages', /^(languages?|ngoại ngữ|ngôn ngữ)\b/i],
  ['awards', /^(awards?|honou?rs?|achievements?|giải thưởng|thành tích|khen thưởng)\b/i],
  ['activities', /^(activities|volunteer|extracurricular|clubs?|hoạt động|tình nguyện|câu lạc bộ|ngoại khoá|ngoại khóa)\b/i],
]

/**
 * Một dòng được coi là tiêu đề mục khi: ngắn, không kết thúc bằng dấu câu,
 * và (viết hoa toàn bộ HOẶC khớp từ khoá đã biết).
 */
function headingKind(line: string): SectionKind | null {
  const t = line.trim().replace(/^[•▪◦\-–—*·\s]+/, '').replace(/[:：]\s*$/, '')
  if (t.length < 3 || t.length > 46) return null
  if (/[.;,]$/.test(t)) return null
  // Dòng có quá nhiều từ thì là nội dung, không phải tiêu đề
  if (t.split(/\s+/).length > 5) return null

  for (const [kind, re] of HEADINGS) {
    if (re.test(t)) return kind
  }
  // ALL CAPS mà không khớp từ khoá nào → mục lạ, vẫn tách ra
  const letters = t.replace(/[^\p{L}]/gu, '')
  if (letters.length >= 3 && letters === letters.toUpperCase() && /\p{L}/u.test(letters)) {
    return 'unknown'
  }
  return null
}

export function segmentCv(text: string): CvSection[] {
  const lines = text.split('\n')
  const sections: CvSection[] = []
  let current: CvSection | null = null
  const preamble: string[] = []

  for (const line of lines) {
    const kind = headingKind(line)
    if (kind) {
      if (current) sections.push(current)
      current = { kind, heading: line.trim(), body: '' }
    } else if (current) {
      current.body += line + '\n'
    } else {
      preamble.push(line)
    }
  }
  if (current) sections.push(current)

  // Phần đầu trước tiêu đề đầu tiên (tên, chức danh, liên hệ) → introduce
  const head = preamble.join('\n').trim()
  if (head.length > 0) {
    sections.unshift({ kind: 'introduce', heading: '(đầu trang)', body: head })
  }

  return sections
    .map((s) => ({ ...s, body: s.body.trim() }))
    .filter((s) => s.body.length > 0)
}

/** Gộp các mục cùng loại (CV hay tách "Work Experience" và "Internships") */
export function mergeByKind(sections: CvSection[]): Map<SectionKind, string> {
  const out = new Map<SectionKind, string>()
  for (const s of sections) {
    const prev = out.get(s.kind)
    const chunk = `${s.heading}\n${s.body}`
    out.set(s.kind, prev ? `${prev}\n\n${chunk}` : chunk)
  }
  return out
}
