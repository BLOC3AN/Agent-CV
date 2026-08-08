/**
 * Chia một mục CV thành từng CHỖ LÀM / từng mục con — TDD §6.4 bước 5.
 *
 * ── Vì sao cần ──
 * `parse_cv_to_profile` sinh tối đa ~1800 token output. Một mục kinh nghiệm có
 * 5 chỗ làm (CV-06: 5301 ký tự) cần nhiều hơn thế RẤT nhiều: mỗi chỗ làm có 4–6
 * gạch đầu dòng, lại phải dịch sang tiếng Việt (1.29× token).
 *
 * Vượt `maxTokens` khi đang decode có grammar ràng buộc thì JSON bị cắt giữa
 * câu → `SCHEMA_INVALID` → retry hai lần cũng cắt đúng chỗ đó → mục hỏng HẲN.
 * Nghĩa là sửa xong bước chia mục (lấy đủ 5 chỗ làm) mà không chia nhỏ tiếp thì
 * người dùng đi từ "thấy 1 chỗ làm" sang "thấy 0 chỗ làm".
 *
 * Chia theo mục con còn giúp độ chính xác: đây chính là lý do §8.1.2 parse từng
 * mục thay vì cả CV — model 4B mất chú ý theo độ dài. Một chỗ làm một lượt là
 * mức chia nhỏ tự nhiên tiếp theo.
 */

/**
 * Dòng có dấu đầu dòng — không bao giờ mở một mục con mới.
 *
 * Tập ký tự rộng có chủ đích: CV-04 dùng ● (U+25CF) chứ không phải • (U+2022).
 * Bỏ sót một ký tự đầu dòng làm cả mục mất ranh giới và không chia được khúc.
 */
const BULLET = /^[\s​]*(?:[•▪▫◦●○◆◇■□▸▶►‣⁃➢✦✔✓*·]|[-–—]\s)/

/**
 * Dấu hiệu thời gian: năm, tháng/năm, hoặc từ chỉ hiện tại.
 * Mọi chỗ làm và mục con trong CV đều có mốc thời gian — đó là tín hiệu ổn định
 * nhất để nhận ranh giới, ổn định hơn cách viết hoa hay thụt lề.
 */
const DATE = /\b(19|20)\d{2}\b|\b(present|current|now|ongoing|nay|hiện tại)\b/i

/** Bao nhiêu dòng có chữ sau tiêu đề mục con còn được coi là "đi kèm nó" */
const DATE_WINDOW = 3

/** Dòng tiêu đề mục con dài nhất — dài hơn thì là câu văn, không phải tiêu đề */
const MAX_TITLE_CHARS = 70

function hasContent(line: string): boolean {
  return line.trim().length > 0
}

/**
 * Dòng này là phần ĐUÔI của một câu bị ngắt dòng, không phải tiêu đề mới.
 *
 * Nhận qua TỪ ĐẦU TIÊN: đuôi câu bắt đầu bằng một từ viết thường hoàn toàn
 * ("and health tracking of production workloads.", "dle reduction).",
 * "configurations) and established…"), còn tên công ty thì không — kể cả tên
 * viết kiểu camelCase như "iMESPRO", "bTaskee", "iTechwx Company Limited".
 *
 * Không dùng "dòng trước có kết thúc câu hay không": CV-07 xếp tiêu đề chỗ làm
 * ngay sau dòng "Tech Stack: …" không có dấu chấm, nên luật đó bỏ mất chỗ làm.
 */
function isWrappedTail(t: string): boolean {
  const first = t.split(/\s+/)[0]!.replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, '')
  return first.length > 0 && /^\p{Ll}+$/u.test(first)
}

/**
 * Dòng này có phải MỞ ĐẦU một mục con? Đúng khi nó ngắn, không có dấu đầu dòng,
 * và có mốc thời gian ở chính nó hoặc ở vài dòng đi kèm ngay sau.
 */
function looksLikeEntryStart(lines: string[], i: number): boolean {
  const line = lines[i]!
  const t = line.trim()
  if (t.length < 2 || t.length > MAX_TITLE_CHARS) return false
  if (BULLET.test(line)) return false
  if (!/[\p{L}\d]/u.test(t)) return false
  if (isWrappedTail(t)) return false

  if (DATE.test(t)) return true

  let seen = 0
  for (let j = i + 1; j < lines.length && seen < DATE_WINDOW; j++) {
    const next = lines[j]!
    if (!hasContent(next)) continue
    seen++
    if (BULLET.test(next)) return false // đã sang phần mô tả → tiêu đề hết rồi
    if (DATE.test(next)) return true
  }
  return false
}

/**
 * Ranh giới giữa các mục con.
 *
 * Bỏ dòng 0: `merge_by_kind` luôn đặt tiêu đề mục ở dòng đầu, và tiêu đề đó
 * phải đi cùng MỌI khúc để model biết đang đọc mục gì.
 *
 * Yêu cầu "đã thấy một dòng gạch đầu dòng kể từ ranh giới trước" là để không
 * cắt vụn phần đầu của một mục con. Chỗ làm hay viết ba dòng liền nhau —
 * tên công ty / chức danh / thời gian — mà cả ba đều thoả điều kiện tiêu đề.
 */
function entryBoundaries(lines: string[]): number[] {
  const out: number[] = []
  let sawBullet = false
  for (let i = 1; i < lines.length; i++) {
    if (BULLET.test(lines[i]!)) {
      sawBullet = true
      continue
    }
    if (!looksLikeEntryStart(lines, i)) continue
    if (out.length > 0 && !sawBullet) continue
    out.push(i)
    sawBullet = false
  }
  return out
}

/** Ranh giới dự phòng khi không nhận ra mục con nào: từng dấu đầu dòng */
function bulletBoundaries(lines: string[]): number[] {
  const out: number[] = []
  for (let i = 1; i < lines.length; i++) {
    if (BULLET.test(lines[i]!)) out.push(i)
  }
  return out
}

function pack(preamble: string[], groups: string[][], maxChars: number): string[] {
  const head = preamble.join('\n')
  const prefix = head.trim() === '' ? '' : head + '\n'

  const chunks: string[] = []
  let current: string[] = []
  let size = 0

  const flush = (): void => {
    if (current.length === 0) return
    chunks.push(prefix + current.join('\n'))
    current = []
    size = 0
  }

  for (const g of groups) {
    const text = g.join('\n')
    // Mục con TỰ NÓ đã vượt hạn mức thì đứng riêng một khúc. Cắt giữa một chỗ
    // làm sẽ tách phần mô tả ra khỏi tên công ty của nó — model không còn biết
    // gạch đầu dòng đó thuộc về đâu.
    if (text.length > maxChars) {
      flush()
      chunks.push(prefix + text)
      continue
    }
    if (size > 0 && size + text.length > maxChars) flush()
    current.push(text)
    size += text.length + 1
  }
  flush()

  return chunks.length > 0 ? chunks : [prefix.trim()]
}

/**
 * Chia text của một mục thành các khúc, mỗi khúc tối đa `maxChars` ký tự.
 *
 * Không bao giờ cắt giữa một mục con. Tiêu đề mục được lặp ở đầu mỗi khúc.
 * Mục ngắn trả về đúng một khúc — phần lớn CV đi đường này.
 */
export function chunkSection(text: string, maxChars = 1_800): string[] {
  const trimmed = text.trim()
  if (trimmed.length <= maxChars) return [trimmed]

  const lines = trimmed.split('\n')
  let bounds = entryBoundaries(lines)
  if (bounds.length < 2) bounds = bulletBoundaries(lines)
  // Không nhận ra ranh giới nào: gửi nguyên khối. Thà chịu rủi ro bị cắt output
  // còn hơn cắt bừa giữa câu rồi gửi hai nửa vô nghĩa (TDD §6.4 cấm cắt cụt).
  if (bounds.length < 2) return [trimmed]

  const preamble = lines.slice(0, bounds[0]!)
  const groups: string[][] = []
  for (let i = 0; i < bounds.length; i++) {
    groups.push(lines.slice(bounds[i]!, bounds[i + 1] ?? lines.length))
  }

  return pack(preamble, groups, maxChars)
}
