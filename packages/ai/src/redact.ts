/**
 * Che PII trong text CV trước khi gửi model — TDD §15.2 R1, bước [3] của §8.1.
 *
 * Làm bằng CODE, không nhờ model: model có thể bỏ sót, và gửi PII đi rồi thì
 * không rút lại được. Đây là ranh giới tin cậy — mọi text đi ra khỏi tiến trình
 * này phải đã qua đây.
 *
 * Cặp `redactPII` / `RedactionMap` cho phép gắn danh tính thật trở lại sau khi
 * model trả kết quả, mà không bao giờ để danh tính đó rời khỏi máy.
 */

export interface RedactionMap {
  NAME?: string
  EMAIL?: string[]
  PHONE?: string[]
  DOB?: string[]
  LOCATION?: string[]
}

export interface RedactResult {
  text: string
  map: RedactionMap
  count: number
}

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]{2,}/g

/**
 * Số điện thoại VN. Đo trên 6 CV thật: mỗi CV một kiểu viết khác nhau. Mẫu
 * dưới đây là dữ liệu TỔNG HỢP giữ nguyên hình dạng (không phải số thật):
 *
 *     +8491 234 5678      0901234567        (+84) 912345678
 *     +84900112233        0312345678        +84 987654321
 *
 * Bản đầu (`(?:\+?84|0)(?:3|5|7|8|9)…`) BỎ SÓT hai kiểu cuối vì nó đòi chữ số
 * mạng đứng ngay sau mã nước — có dấu ngoặc hoặc dấu cách xen vào là trượt.
 * Bỏ sót ở đây nghĩa là số điện thoại thật đi thẳng tới model (§15.2 R1).
 *
 * `(?<![\d+])` chặn bắt nhầm phần đuôi của một dãy số dài hơn.
 */
const PHONE = /(?<![\d+])(?:\(\s*\+?84\s*\)|\+\s*84|84(?=[\s.-])|0)[\s.-]*[35789][\d\s.-]{7,11}\d/g

const DOB = /\b(?:0?[1-9]|[12]\d|3[01])[/\-.](?:0?[1-9]|1[0-2])[/\-.](?:19|20)\d{2}\b/g

/**
 * Địa chỉ đường phố VN — có số nhà/ngõ/phường/quận thì mới coi là PII.
 *
 * Viết tắt `q`/`p` phải được rào hai đầu: bản đầu khớp "Q15" bên trong token
 * `Q15ABCDEF0GH` (mã theo dõi trong URL LinkedIn) và xoá mất 40 ký tự kế bên.
 * Che nhầm cũng hỏng như bỏ sót — nó cắt mất nội dung thật gửi cho model.
 */
const STREET = new RegExp(
  '(?:' +
    '\\b(?:số|ngõ)\\s*\\d+[^\\n,]{0,40}' +
    '|\\b(?:đường|phố|quận|phường)\\s+[\\p{L}\\d][^\\n,]{0,40}' +
    // Viết tắt quận/phường BẮT BUỘC có dấu chấm: "Q.7" hầu như chỉ là địa chỉ,
    // còn "Q4", "P3", "H2" trong CV IT thường là quý tài chính, mức ưu tiên,
    // hay tên công nghệ. Che nhầm chúng cắt mất nội dung thật gửi cho model.
    '|(?<![\\p{L}\\d])[qp]\\.\\s*\\d{1,2}(?![\\p{L}\\d])' +
    ')',
  'giu',
)

/**
 * Tên người ở CV hầu như luôn nằm ở dòng đầu, in đậm, không có động từ.
 * Heuristic: 2–5 từ viết hoa chữ cái đầu, trong 4 dòng đầu tiên.
 *
 * Âm tiết MỘT CHỮ CÁI phải được chấp nhận (`*` chứ không phải `+`): tên Việt
 * có "Y", "Á", "Ý"… đứng riêng. Một CV thật trong bộ đo có tên dạng này và nó
 * trượt hoàn toàn ở bản đầu — tên thật đi thẳng tới model.
 */
const NAME_LINE = /^[\p{Lu}][\p{L}']*(?:\s+[\p{Lu}][\p{L}']*){1,4}$/u

/**
 * Tiêu đề mục cũng là "vài từ viết hoa, không dấu câu" nên khớp `NAME_LINE`.
 * CV bắt đầu bằng "WORK EXPERIENCE" (dòng tên nằm trong ảnh header, hoặc engine
 * đọc lệch thứ tự) sẽ bị lấy tiêu đề làm tên và thay bằng `<NAME>` — mất luôn
 * ranh giới mục, kéo theo bước chia mục ở §8.1.2 hỏng theo.
 *
 * Liệt kê theo TỪNG ÂM TIẾT, không theo cụm: tiếng Việt viết rời nên "HỌC VẤN"
 * phải khớp được cả khi tách thành "HỌC" và "VẤN".
 */
const HEADING_WORDS = new Set(
  (
    'summary profile objective about introduction education academic work ' +
    'experience employment professional career project projects portfolio ' +
    'skill skills technical technologies certification certifications ' +
    'certificate certificates language languages award awards activities ' +
    'volunteer interest interests reference references contact info ' +
    'giới thiệu mục tiêu tóm tắt học vấn trình độ bằng cấp kinh nghiệm ' +
    'quá công tác dự án sản phẩm đồ kỹ năng nghệ chuyên môn chứng chỉ nhận ' +
    'ngoại ngữ ngôn giải thưởng hoạt động sở thích thông tin liên hệ cá nhân'
  ).split(' '),
)

/**
 * Dòng có phải tiêu đề mục không — MỌI âm tiết đều nằm trong danh sách.
 *
 * Đòi "mọi" chứ không phải "có một" là cố ý: âm tiết như "công", "quá", "cá"
 * cũng xuất hiện trong tên người ("Lê Công Minh"), nhưng cả dòng toàn âm tiết
 * tiêu đề thì gần như chắc chắn không phải tên.
 */
function looksLikeHeading(line: string): boolean {
  const words = line
    .toLowerCase()
    .split(/[\s:·|–—-]+/)
    .filter(Boolean)
  return words.length > 0 && words.every((w) => HEADING_WORDS.has(w))
}

export function redactPII(text: string): RedactResult {
  const map: RedactionMap = {}
  let count = 0

  const lines = text.split('\n')
  for (let i = 0; i < Math.min(4, lines.length); i++) {
    const t = (lines[i] ?? '').trim()
    if (t.length >= 4 && t.length <= 60 && NAME_LINE.test(t) && !looksLikeHeading(t)) {
      map.NAME = t
      lines[i] = (lines[i] ?? '').replace(t, '<NAME>')
      count++
      break
    }
  }
  let out = lines.join('\n')

  const swap = (re: RegExp, token: keyof RedactionMap, placeholder: string): void => {
    const found = out.match(re)
    if (!found) return
    ;(map[token] as string[]) = [...new Set(found.map((s) => s.trim()))]
    out = out.replace(re, placeholder)
    count += found.length
  }

  swap(EMAIL, 'EMAIL', '<EMAIL>')
  swap(PHONE, 'PHONE', '<PHONE>')
  swap(DOB, 'DOB', '<DOB>')
  swap(STREET, 'LOCATION', '<LOCATION>')

  return { text: out, map, count }
}

/**
 * Che nhiều mục nhưng dùng CHUNG một bản đồ.
 *
 * Vì sao cần: sau khi chia mục (TDD §8.1.2), gọi `redactPII` riêng từng mục sẽ
 * cho mỗi mục một `map` khác nhau, và mục nào không chứa dòng tên thì không
 * biết tên là gì. Một bản đồ chung giữ danh tính thống nhất cho cả CV.
 *
 * Thứ tự quan trọng: quét toàn văn TRƯỚC để bắt được dòng tên ở đầu trang, rồi
 * mới áp cùng bộ giá trị đó lên từng mục.
 */
export function redactSections(
  fullText: string,
  sections: Record<string, string>,
): { sections: Record<string, string>; map: RedactionMap; count: number } {
  const whole = redactPII(fullText)
  const out: Record<string, string> = {}

  for (const [kind, body] of Object.entries(sections)) {
    let t = body
    if (whole.map.NAME) t = t.split(whole.map.NAME).join('<NAME>')
    t = t.replace(EMAIL, '<EMAIL>').replace(PHONE, '<PHONE>').replace(DOB, '<DOB>')
    t = t.replace(STREET, '<LOCATION>')
    out[kind] = t
  }

  return { sections: out, map: whole.map, count: whole.count }
}

/**
 * Danh tính thật, tách ra khỏi luồng model. Lưu riêng, ghép lại ở tầng ứng dụng.
 */
export interface Identity {
  name: string
  email?: string
  phone?: string
  location?: string
  dob?: string
}

/** Dựng danh tính từ bản đồ che. Lấy giá trị đầu tiên khi có nhiều. */
export function identityFromMap(map: RedactionMap, fallbackName = 'Chưa rõ tên'): Identity {
  return {
    name: map.NAME ?? fallbackName,
    email: map.EMAIL?.[0],
    phone: map.PHONE?.[0],
    location: map.LOCATION?.[0],
    dob: map.DOB?.[0],
  }
}
