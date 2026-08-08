/**
 * Bộ đo `field_accuracy` — TDD §13.2, TESTCASES TC-21-01, X-3.
 *
 * ── Vì sao cần một bộ đo riêng ──
 * Test tích hợp trả lời câu hỏi nhị phân: "có chạy không". Nhưng câu hỏi thật
 * của việc đọc CV là *"đọc đúng bao nhiêu phần trăm"* — và con số đó chỉ có
 * nghĩa khi so được giữa hai lần chạy. Sửa prompt xong mà không đo thì không
 * biết mình vừa làm tốt lên hay tệ đi.
 *
 * Đây chính là khoảng mù đã sinh ra gần như mọi lỗi trong dự án này: kiểm cơ
 * chế chứ không kiểm kết quả.
 *
 *   npx tsx eval/run.ts             # chạy mọi CV có nhãn chuẩn
 *   npx tsx eval/run.ts CV-06       # chạy một CV
 *   npx tsx eval/run.ts --json      # xuất JSON để so giữa hai lần chạy
 */

import { readFile, readdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Gateway, makeSectionTask } from '@hr/ai'
import { chunkSection } from '@hr/worker/cv-chunk'
import { ProfileSchema, type Profile } from '@hr/schema'

const HERE = dirname(fileURLToPath(import.meta.url))
const PDFKIT = process.env['PDFKIT_URL'] ?? 'http://localhost:8100'

/** Mục nào được đo, và trọng số khi gộp thành một điểm. */
const SECTIONS = ['work', 'education', 'projects', 'skills'] as const
type Section = (typeof SECTIONS)[number]

interface FieldScore {
  section: Section
  /** Số field khớp / tổng số field trong nhãn chuẩn */
  matched: number
  total: number
  /** Field sai — in ra để biết sửa gì, không chỉ biết điểm */
  misses: string[]
}

interface CvResult {
  cv: string
  scores: FieldScore[]
  accuracy: number
  /** Mục nào model trả về rỗng hoàn toàn — hỏng nặng hơn sai từng field */
  emptySections: Section[]
  /**
   * Số lượt gọi model HỎNG. Khác 0 nghĩa là con số accuracy KHÔNG dùng để so
   * sánh giữa các lần chạy được — thiếu dữ liệu, không phải model kém đi.
   */
  failedCalls: number
}

/** Bỏ dấu tiếng Việt để so "Hiện tại" với "hien tai". */
function deaccent(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
}

/** So chuỗi khoan dung: bỏ dấu câu, gộp khoảng trắng, không phân biệt hoa thường. */
function loose(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Hai chuỗi coi là khớp khi một bên chứa bên kia.
 *
 * Không đòi khớp tuyệt đối: model viết "Nokia" còn nhãn ghi "Nokia Corporation"
 * là đọc ĐÚNG, chỉ khác độ chi tiết. Đòi khớp tuyệt đối sẽ cho một con số bi
 * quan giả và che mất những lỗi thật.
 */
/**
 * Các cách viết "tới nay" — nhãn chuẩn ghi tiếng Anh, model xuất tiếng Việt
 * theo `outputLanguage`. Coi hai bên khác nhau là phạt model vì đã nghe lời.
 */
const NOW_WORDS = new Set(['present', 'current', 'now', 'hien tai', 'nay', 'den nay', 'toi nay'])

function same(a: unknown, b: unknown): boolean {
  const x = loose(a)
  const y = loose(b)
  if (NOW_WORDS.has(deaccent(x)) && NOW_WORDS.has(deaccent(y))) return true
  if (!x && !y) return true
  if (!x || !y) return false
  return x === y || x.includes(y) || y.includes(x)
}

/** Field được đo cho từng loại mục — chỉ những field NHÀ TUYỂN DỤNG đọc. */
const FIELDS: Record<Section, string[]> = {
  work: ['org', 'role', 'startDate', 'endDate'],
  education: ['school', 'degree', 'major'],
  projects: ['name'],
  skills: ['name'],
}

/**
 * Field dùng để GHÉP mục đọc được với mục trong nhãn chuẩn.
 *
 * Không dùng một field: CV-01 có HAI mục ở Nokia (Scrum Master, rồi Software
 * Engineer), ghép theo `org` thì cả hai cùng khớp vào mục đầu và mọi mốc thời
 * gian của mục thứ hai bị tính sai. Bộ đo báo lỗi cho model vì lỗi của chính
 * bộ đo — kiểu hỏng tệ nhất ở một công cụ đo lường.
 */
function sameKey(a: unknown, b: unknown): boolean {
  // Ghép khoá phải CHẶT. Với `same()` khoan dung, "Scrum Master & Senior
  // Software Engineer" CHỨA "Software Engineer" nên hai chức danh khác hẳn
  // nhau vẫn ghép vào một — đúng cái lỗi mà KEY_FIELDS sinh ra để tránh.
  return loose(a) === loose(b)
}

const KEY_FIELDS: Record<Section, string[]> = {
  work: ['org', 'role'],
  education: ['school', 'degree'],
  projects: ['name'],
  skills: ['name'],
}

function scoreSection(section: Section, got: unknown[], want: unknown[]): FieldScore {
  const misses: string[] = []
  let matched = 0
  let total = 0

  for (const [i, w] of want.entries()) {
    const wr = w as Record<string, unknown>
    // Ghép theo NỘI DUNG chứ không theo thứ tự: model đảo thứ tự các mục vẫn là
    // đọc đúng, mà so theo chỉ số thì cả danh sách trượt và điểm về gần 0.
    const keys = KEY_FIELDS[section]
    const g = (got as Record<string, unknown>[]).find((x) => keys.every((k) => sameKey(x[k], wr[k])))

    for (const f of FIELDS[section]) {
      if (wr[f] === undefined || wr[f] === null || wr[f] === '') continue
      total++
      if (g && same(g[f], wr[f])) matched++
      else misses.push(`${section}[${i}].${f} = ${JSON.stringify(wr[f])}`)
    }
  }
  return { section, matched, total, misses }
}

async function segment(cv: string): Promise<Record<string, string> | null> {
  const buf = await readFile(resolve(HERE, `cv/${cv}.pdf`)).catch(() => null)
  if (!buf) return null
  const form = new FormData()
  form.append('file', new Blob([buf]), `${cv}.pdf`)
  const res = await fetch(`${PDFKIT}/segment`, { method: 'POST', body: form })
  const j = (await res.json()) as { merged?: Record<string, string> }
  return j.merged ?? {}
}

/**
 * Đọc một mục, và BÁO LẠI số lượt gọi hỏng.
 *
 * ── Vì sao phải đếm ──
 * Bản đầu bỏ qua lượt gọi hỏng (`if (r.ok)`), nên một lần server hụt hơi hiện
 * ra y hệt như "model đọc sai". Đo thật: CV-10 cho 96,4% rồi 25,5% ở hai lần
 * chạy liên tiếp trên cùng dữ liệu — không phải model tệ đi, mà là một lượt gọi
 * chết và bộ đo im lặng nuốt mất.
 *
 * Một công cụ đo báo sai kiểu đó tệ hơn không có công cụ nào: nó cử người đi
 * săn một hồi quy không tồn tại.
 */
async function parseSection(
  gw: Gateway,
  kind: Section,
  text: string,
): Promise<{ items: unknown[]; failed: number; total: number }> {
  const task = makeSectionTask(kind)
  const items: unknown[] = []
  let failed = 0
  // Chia mục dài thành từng chỗ làm — cùng đường với worker thật, nếu không thì
  // bộ đo sẽ báo một con số mà sản phẩm không bao giờ đạt được (TDD §8.1.2).
  const chunks = chunkSection(text, 1_800)
  for (const chunk of chunks) {
    const r = await gw.run(task, { kind, text: chunk, outputLanguage: 'vi' })
    if (r.ok) items.push(...((r.data as { items?: unknown[] }).items ?? []))
    else failed++
  }
  return { items, failed, total: chunks.length }
}

async function runOne(gw: Gateway, cv: string, golden: Profile): Promise<CvResult | null> {
  const merged = await segment(cv)
  if (!merged) return null

  const scores: FieldScore[] = []
  const emptySections: Section[] = []
  let failedCalls = 0

  for (const s of SECTIONS) {
    const want = (golden[s] ?? []) as unknown[]
    if (want.length === 0) continue

    const text = merged[s]
    const r = text ? await parseSection(gw, s, text) : { items: [], failed: 0, total: 0 }
    failedCalls += r.failed
    if (r.items.length === 0) emptySections.push(s)
    scores.push(scoreSection(s, r.items, want))
  }

  const matched = scores.reduce((a, s) => a + s.matched, 0)
  const total = scores.reduce((a, s) => a + s.total, 0)
  return { cv, scores, accuracy: total === 0 ? 0 : matched / total, emptySections, failedCalls }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const asJson = args.includes('--json')
  const only = args.filter((a) => !a.startsWith('--'))

  const goldenDir = resolve(HERE, 'golden')
  const files = (await readdir(goldenDir).catch(() => [])).filter((f) => f.endsWith('.vi.json'))
  const names = files.map((f) => f.replace('.vi.json', '')).filter((n) => !only.length || only.includes(n))

  if (names.length === 0) {
    console.error('Không có nhãn chuẩn nào trong eval/golden/. Xem eval/README.md.')
    process.exit(1)
  }

  const gw = new Gateway()
  const results: CvResult[] = []

  for (const cv of names) {
    const golden = ProfileSchema.parse(
      JSON.parse(await readFile(resolve(goldenDir, `${cv}.vi.json`), 'utf8')),
    )
    const r = await runOne(gw, cv, golden)
    if (!r) {
      // File PDF chứa PII nên không commit — máy khác chạy sẽ không có
      console.warn(`⏭  ${cv}: không có eval/cv/${cv}.pdf trên máy này`)
      continue
    }
    results.push(r)

    if (!asJson) {
      const pct = (r.accuracy * 100).toFixed(1)
      console.log(`\n${cv}  field_accuracy = ${pct}%`)
      for (const s of r.scores) {
        const p = s.total === 0 ? 0 : (s.matched / s.total) * 100
        console.log(`   ${s.section.padEnd(10)} ${s.matched}/${s.total}  ${p.toFixed(0)}%`)
      }
      if (r.emptySections.length) console.log(`   ⚠ mục RỖNG: ${r.emptySections.join(', ')}`)
      if (r.failedCalls > 0) {
        console.log(`   🔴 ${r.failedCalls} lượt gọi model HỎNG — con số trên KHÔNG so sánh được`)
      }
      // In ra field sai để biết sửa gì — điểm số một mình không nói được gì
      for (const s of r.scores) for (const m of s.misses.slice(0, 4)) console.log(`     ✗ ${m}`)
    }
  }

  if (results.length === 0) process.exit(0)

  // Chỉ gộp những CV chạy TRỌN VẸN. Trộn cả CV có lượt gọi hỏng vào trung bình
  // là trộn "model đọc sai" với "server hụt hơi" — hai thứ cần hai cách xử lý
  // khác hẳn nhau.
  const clean = results.filter((r) => r.failedCalls === 0)
  const dirty = results.length - clean.length
  if (dirty > 0) console.log(`\n⚠ bỏ ${dirty} CV khỏi trung bình vì có lượt gọi model hỏng`)
  if (clean.length === 0) {
    console.log('Không CV nào chạy trọn vẹn — kiểm lại model server rồi chạy lại.')
    process.exit(1)
  }
  const overall = clean.reduce((a, r) => a + r.accuracy, 0) / clean.length
  if (asJson) {
    console.log(JSON.stringify({ overall, cleanCount: clean.length, results }, null, 2))
  } else {
    console.log(`\n─────────────────────────────`)
    console.log(`field_accuracy trung bình: ${(overall * 100).toFixed(1)}%  (${clean.length} CV chạy trọn vẹn)`)
    // Ngưỡng TC-21-01. Không tự động fail: bộ đo này để THEO DÕI xu hướng, còn
    // cổng chặn nằm ở test tích hợp.
    console.log(overall >= 0.9 ? '✓ đạt ngưỡng 0.90 (TC-21-01)' : '✗ dưới ngưỡng 0.90 (TC-21-01)')
  }
}

await main()
