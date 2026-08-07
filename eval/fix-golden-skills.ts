/**
 * Sửa nhãn chuẩn: mục `skills` đang ghi TÊN NHÓM thay vì kỹ năng — X-3.
 *
 * ── Vì sao phải sửa ──
 * CV viết mục kỹ năng theo dạng `Frontend: React.js, Redux, TypeScript`. Nhãn
 * chuẩn ban đầu ghi lại `Frontend` làm một kỹ năng — đó là TIÊU ĐỀ NHÓM, không
 * phải kỹ năng. Model từng làm đúng như vậy và đã được sửa (`EXTRA_RULES` trong
 * prompt kỹ năng), nên nhãn chuẩn nay đang đo một hành vi mà sản phẩm đã bỏ.
 *
 * Đo được: CV-01 68% → skills 0/8; CV-06 skills 0/4; CV-10 skills bỏ sót 4 nhóm.
 *
 * Đây KHÔNG phải chỉnh nhãn cho điểm đẹp. Bằng chứng: sau khi sửa, `skills` của
 * CV-01 lên 21/31 chứ không phải 31/31 — phần model bỏ sót vẫn hiện ra.
 *
 * Từ khi có UC-57, `group` biểu diễn được nên nhãn giữ nguyên thông tin nhóm.
 *
 *   npx tsx eval/fix-golden-skills.ts          # xem trước
 *   npx tsx eval/fix-golden-skills.ts --write  # ghi
 */

import { readFile, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PDFKIT = process.env['PDFKIT_URL'] ?? 'http://localhost:8100'
const WRITE = process.argv.includes('--write')

/**
 * Ba định dạng mục kỹ năng gặp trên CV thật:
 *
 *   A  `Frontend: React.js, Redux`            (CV-01)
 *   B  `• Languages & Frameworks: Python, …`  (CV-06 — có dấu đầu dòng)
 *   C  `Backend`  rồi dòng sau  `Node.js, …`  (CV-10 — nhóm đứng riêng dòng)
 *
 * Một CV chỉ dùng một kiểu, nhưng bộ đọc phải nhận cả ba: nhãn chuẩn sai vì
 * đọc hụt còn tệ hơn không có nhãn — nó làm mọi phép đo về sau lệch mà không
 * ai biết.
 */
const BULLET = /^[•·▪◦*\-\u2022]\s*/
const GROUP_INLINE = /^([^:\n]{2,40}):\s*(.+)$/

interface Skill {
  name: string
  group?: string
}

const isHeading = (s: string): boolean => /^(technical\s+|core\s+)?skills?$/i.test(s.trim())

/** Dòng liệt kê: có dấu phẩy, không có hai chấm, và không quá dài. */
const looksLikeList = (s: string): boolean => s.includes(',') && !s.includes(':')

function splitNames(raw: string, group: string, out: Skill[]): void {
  // Cắt dấu phẩy NGOÀI ngoặc: "Vue 3 (Composition API), Vite" cắt bừa thành
  // "Vue 3 (Composition" và "API)" — hai mảnh vô nghĩa nằm luôn trong nhãn chuẩn.
  const parts = raw.match(/(?:[^,;(]|\([^)]*\))+/g) ?? []
  for (const part of parts) {
    const name = part
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/\.$/, '')
      // Nhãn chuẩn phải theo ĐÚNG luật đã dặn model (EXTRA_RULES.skills):
      // bỏ số phiên bản và ghi chú trong ngoặc. Nhãn giữ "Laravel 12" trong khi
      // prompt bảo model viết "Laravel" thì bộ đo phạt model vì đã nghe lời.
      .replace(/\s+\d+(\.\d+)*$/, '')
      .replace(/\s*\([^)]*\)\s*$/, '')
      .trim()
    if (name.length >= 2 && name.length <= 60) out.push({ name, group })
  }
}

function parseSkills(text: string): Skill[] {
  // Nối dòng bị ngắt giữa chừng: PDF xuống dòng theo bề rộng trang, không theo
  // ý nghĩa. Không nối thì "TensorFlow Lite Micro, ONNX," và "TensorRT" thành
  // hai nhóm khác nhau.
  const lines: string[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const prev = lines[lines.length - 1]
    // Dòng nối tiếp: dòng trước kết thúc bằng dấu phẩy và dòng này không mở nhóm mới
    if (prev && /,$/.test(prev) && !BULLET.test(line) && !GROUP_INLINE.test(line)) {
      lines[lines.length - 1] = `${prev} ${line}`
    } else {
      lines.push(line)
    }
  }

  const out: Skill[] = []
  let pendingGroup: string | null = null

  for (const line of lines) {
    const body = line.replace(BULLET, '')
    if (isHeading(body)) continue

    const m = GROUP_INLINE.exec(body)
    if (m) {
      // Kiểu A và B
      pendingGroup = null
      splitNames(m[2]!, m[1]!.trim(), out)
      continue
    }

    if (pendingGroup && looksLikeList(body)) {
      // Kiểu C: dòng liệt kê ngay dưới tên nhóm
      splitNames(body, pendingGroup, out)
      pendingGroup = null
      continue
    }

    // Dòng ngắn, không phải danh sách → coi là tên nhóm chờ dòng sau
    if (!looksLikeList(body) && body.length <= 40) pendingGroup = body
  }
  return out
}

async function skillsText(cv: string): Promise<string | null> {
  const buf = await readFile(resolve(HERE, `cv/${cv}.pdf`)).catch(() => null)
  if (!buf) return null
  const form = new FormData()
  form.append('file', new Blob([buf]), `${cv}.pdf`)
  const j = (await fetch(`${PDFKIT}/segment`, { method: 'POST', body: form }).then((r) =>
    r.json(),
  )) as { merged?: Record<string, string> }
  return j.merged?.['skills'] ?? null
}

for (const cv of ['CV-01', 'CV-02', 'CV-04', 'CV-06', 'CV-07', 'CV-10']) {
  const path = resolve(HERE, `golden/${cv}.vi.json`)
  const golden = await readFile(path, 'utf8').then(JSON.parse).catch(() => null)
  if (!golden) continue

  const text = await skillsText(cv)
  if (!text) {
    console.log(`⏭  ${cv}: không có PDF trên máy này`)
    continue
  }

  const parsed = parseSkills(text)
  if (parsed.length === 0) {
    console.log(`⏭  ${cv}: mục kỹ năng không theo dạng "Nhóm: a, b, c" — để nguyên`)
    continue
  }

  const before: Skill[] = golden.skills ?? []
  console.log(`\n${cv}: ${before.length} → ${parsed.length} kỹ năng`)
  console.log(`   trước: ${before.map((s) => s.name).slice(0, 5).join(', ')}`)
  console.log(`   sau:   ${parsed.map((s) => s.name).slice(0, 5).join(', ')}`)

  if (WRITE) {
    golden.skills = parsed
    await writeFile(path, JSON.stringify(golden, null, 2) + '\n')
  }
}

if (!WRITE) console.log('\n(xem trước — thêm --write để ghi)')
