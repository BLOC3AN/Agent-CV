/**
 * Chuẩn hoá text cho lớp khớp từ khoá — TDD §9.2.
 *
 * Hai bài toán phải giải cùng lúc:
 *   1. Người Việt gõ không dấu rất nhiều ("quan ly du an")
 *   2. Tên công nghệ có ký tự đặc biệt mang nghĩa ("C++", "C#", "Node.js",
 *      ".NET") — bỏ hết dấu câu sẽ biến "C++" và "C" thành một, và "C#" thành
 *      "c", khiến CV biết C# bị chấm là biết C
 *
 * Nên: bỏ dấu tiếng Việt nhưng GIỮ `+ # . /` trong token.
 */

/** Bỏ dấu tiếng Việt. `đ`/`Đ` không phải tổ hợp dấu nên phải xử lý riêng. */
export function deaccent(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
}

/**
 * Dạng chuẩn để so khớp: thường, không dấu, khoảng trắng gọn.
 *
 * `+ # . /` được giữ vì chúng phân biệt công nghệ khác nhau. `-` và `_` quy về
 * khoảng trắng vì chúng chỉ là cách viết ("react-router" ≡ "react router").
 */
export function normalize(s: string): string {
  return deaccent(s)
    .toLowerCase()
    .replace(/[_\-–—]+/g, ' ')
    .replace(/[^\p{L}\p{N}+#./ ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Tách thành token để dò khớp.
 *
 * Giữ nguyên token có ký tự đặc biệt: "node.js" là MỘT token, không phải
 * "node" + "js".
 */
export function tokenize(s: string): string[] {
  return normalize(s).split(' ').filter(Boolean)
}

/**
 * Cụm n từ liên tiếp — cần vì nhiều kỹ năng gồm nhiều từ ("spring boot",
 * "quản lý dự án", "message queue"). Dò từng token riêng lẻ sẽ bỏ sót hết.
 */
export function ngrams(tokens: string[], maxN = 4): string[] {
  const out: string[] = []
  for (let n = 1; n <= maxN; n++) {
    for (let i = 0; i + n <= tokens.length; i++) {
      out.push(tokens.slice(i, i + n).join(' '))
    }
  }
  return out
}

/**
 * Alias có xuất hiện trong text đã chuẩn hoá không, THEO RANH GIỚI TỪ.
 *
 * Dùng `includes` sẽ khớp "java" bên trong "javascript" — một CV toàn
 * JavaScript sẽ được chấm là biết Java, và JD tuyển Java sẽ khớp nhầm. Đây là
 * lỗi sai theo hướng nguy hiểm: nó thổi phồng điểm.
 *
 * Không dùng `\b` của regex vì `+`/`#` không phải ký tự từ — `\bc++\b` không
 * bao giờ khớp "c++". Kiểm tra ranh giới thủ công thì đúng với mọi ký tự.
 */
export function containsPhrase(haystack: string, phrase: string): boolean {
  if (!phrase) return false
  let from = 0
  for (;;) {
    const i = haystack.indexOf(phrase, from)
    if (i === -1) return false

    const before = i === 0 ? ' ' : haystack[i - 1]!
    const afterIdx = i + phrase.length
    const after = afterIdx >= haystack.length ? ' ' : haystack[afterIdx]!

    // Ranh giới hợp lệ = khoảng trắng hoặc hết chuỗi. Chữ/số liền kề nghĩa là
    // ta đang đứng giữa một từ dài hơn.
    if (!isWordChar(before) && !isWordChar(after)) return true
    from = i + 1
  }
}

function isWordChar(c: string): boolean {
  return /[\p{L}\p{N}+#.]/u.test(c)
}
