#!/usr/bin/env tsx
/**
 * Dựng fixture CV tiếng Việt từ CV tiếng Anh có sẵn.
 *
 * Luồng — CỐ Ý giống hệt luồng import ở production (TDD §8.1):
 *   1. Trích text + cổng chất lượng      (§8.1.1)
 *   2. Che PII bằng CODE                  (§15.2 R1)  ← trước khi gọi model
 *   3. Chia mục bằng CODE                 (§6.4 bước 5)
 *   4. Parse TỪNG MỤC bằng model          ← không parse cả CV một lượt
 *   5. Gắn danh tính giả                  (chỉ dành cho fixture)
 *   6. Lưu vào eval/golden/*.vi.json
 *
 * Bước 3–4 tồn tại vì: parse cả CV 3000 ký tự một lượt làm model 4B BỎ SÓT
 * nguyên mục (đo được `education: []` dù mục đó nằm nguyên trong text), trong
 * khi parse riêng từng mục thì đúng 3/3 lần.
 *
 * Chạy: npx tsx eval/translate-cv.ts [CV-01 CV-02 ...]
 */
import { readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Gateway, sectionTask, detectPII, type ParseableSection } from '@hr/ai'
import { assembleProfile, ProfileSchema, type ParsedProfile } from '@hr/schema'
import { extractPdf } from './lib/extract.js'
import { redactPII, fakeIdentity } from './lib/redact.js'
import { segmentCv, mergeByKind, type SectionKind } from './lib/segment.js'

const ROOT = dirname(fileURLToPath(import.meta.url))
const CV_DIR = join(ROOT, 'cv')
const OUT_DIR = join(ROOT, 'golden')

const PARSEABLE: ParseableSection[] = [
  'education', 'work', 'projects', 'skills',
  'activities', 'certifications', 'languages',
]

const only = process.argv.slice(2)
const files = readdirSync(CV_DIR)
  .filter((f) => f.toLowerCase().endsWith('.pdf'))
  .filter((f) => only.length === 0 || only.some((o) => f.startsWith(o)))
  .sort()

if (files.length === 0) {
  console.error(`Không có CV nào khớp trong ${CV_DIR}`)
  process.exit(1)
}
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })

const gw = new Gateway()
let ok = 0
let failed = 0
let partial = 0

for (const [i, file] of files.entries()) {
  const cvId = file.replace(/\.pdf$/i, '')
  console.log(`\n▸ ${cvId}`)

  // ── 1. Trích text + cổng chất lượng ──────────────────────────────────────
  const ex = extractPdf(join(CV_DIR, file))
  console.log(
    `  trích  : ${ex.engine} · ${ex.quality} · ${ex.pages}tr · ${ex.columns}cột · ${ex.text.length}kt` +
      (ex.reasons.length ? `  ⚠ ${ex.reasons.join('; ')}` : ''),
  )
  if (ex.quality === 'none') {
    console.log('  ✗ bỏ qua — không text layer, cần đường OCR (M2)')
    failed++
    continue
  }

  // ── 2. Che PII BẰNG CODE, trước khi model nhìn thấy ──────────────────────
  const red = redactPII(ex.text)
  const leaks = detectPII(red.text)
  if (leaks.length > 0) {
    console.log(`  ✗ bộ che PII còn sót (${leaks.map((l) => l.kind).join(',')}) — KHÔNG gửi model`)
    failed++
    continue
  }
  console.log(`  che PII: ${red.count} mục ✓`)

  // ── 3. Chia mục BẰNG CODE ────────────────────────────────────────────────
  const merged = mergeByKind(segmentCv(red.text))
  const present = PARSEABLE.filter((k) => (merged.get(k as SectionKind)?.length ?? 0) > 0)
  console.log(`  chia   : ${present.length} mục parse được → ${present.join(', ') || '(không có)'}`)

  // ── 4. Parse TỪNG MỤC ────────────────────────────────────────────────────
  const t0 = Date.now()
  const parsed: ParsedProfile = {
    schemaVersion: 1,
    language: 'vi',
    basics: { links: [] },
    education: [], work: [], projects: [], skills: [],
    activities: [], certifications: [], languages: [],
  }

  let sectionFails = 0
  for (const kind of present) {
    const text = merged.get(kind as SectionKind)!

    // Máy chủ dùng chung với 109 container khác → chậm nhất thời là bình thường.
    // Thử lại có giãn cách, và CHỜ breaker nguội thay vì đốt hết hàng đợi.
    let r = await gw.run(sectionTask(kind), { kind, text, outputLanguage: 'vi' })
    for (let attempt = 1; !r.ok && attempt <= 2; attempt++) {
      const code = r.error.code
      if (code !== 'TIMEOUT' && code !== 'CIRCUIT_OPEN' && code !== 'MODEL_UNAVAILABLE') break
      const waitMs = code === 'CIRCUIT_OPEN' ? 62_000 : attempt * 15_000
      console.log(`    … ${kind}: ${code}, chờ ${waitMs / 1000}s rồi thử lại (${attempt}/2)`)
      await new Promise((res) => setTimeout(res, waitMs))
      r = await gw.run(sectionTask(kind), { kind, text, outputLanguage: 'vi' })
    }

    if (!r.ok) {
      console.log(`    ✗ ${kind}: ${r.error.code}`)
      sectionFails++
      continue
    }
    const items = (r.data as { items: unknown[] }).items
    ;(parsed[kind] as unknown[]) = items
    console.log(`    ✓ ${kind.padEnd(15)} ${String(items.length).padStart(2)} mục · ${r.meta.latencyMs}ms`)
  }

  // KẾ TOÁN TRUNG THỰC: không có mục nào parse được thì đó là THẤT BẠI,
  // dù file JSON vẫn ghi ra được. Báo "thành công" trên Profile rỗng là
  // đúng kiểu lỗi mà sản phẩm này sinh ra để chống.
  if (present.length > 0 && sectionFails === present.length) {
    console.log(`  ✗ THẤT BẠI — toàn bộ ${present.length} mục đều lỗi, không ghi file`)
    failed++
    continue
  }

  // Tóm tắt lấy từ mục summary nếu có (không cần model)
  const summary = merged.get('summary' as SectionKind)
  if (summary) {
    parsed.basics.summary = summary.split('\n').slice(1).join('\n').trim().slice(0, 600)
  }

  // ── 5. Gắn danh tính giả ─────────────────────────────────────────────────
  const fake = fakeIdentity(i)
  const check = ProfileSchema.safeParse(
    assembleProfile(parsed, {
      name: fake.name, email: fake.email, phone: fake.phone,
      location: fake.location, dob: fake.dob,
    }),
  )
  if (!check.success) {
    console.log(`  ✗ Profile không hợp lệ: ${check.error.issues[0]?.message}`)
    failed++
    continue
  }

  // ── 6. Lưu ───────────────────────────────────────────────────────────────
  writeFileSync(join(OUT_DIR, `${cvId}.vi.json`), JSON.stringify(check.data, null, 2) + '\n', 'utf8')
  const p = check.data
  const complete = sectionFails === 0
  if (!complete) partial++
  console.log(
    `  ${complete ? '✓' : '⚠'} ${((Date.now() - t0) / 1000).toFixed(1)}s · học vấn ${p.education.length} · ` +
      `kinh nghiệm ${p.work.length} · dự án ${p.projects.length} · kỹ năng ${p.skills.length}` +
      (sectionFails ? `  ⚠ THIẾU ${sectionFails}/${present.length} mục — chưa dùng làm golden được` : ''),
  )
  ok++
}

console.log(`\n${'─'.repeat(62)}`)
console.log(
  `Xong: ${ok - partial} đầy đủ · ${partial} thiếu mục · ${failed} thất bại  ` +
    `(tổng ${files.length})`,
)
if (partial > 0) {
  console.log(`⚠ ${partial} file thiếu mục — chạy lại chỉ những file đó trước khi dùng làm golden.`)
}
console.log('→ eval/golden/*.vi.json (gitignored — dẫn xuất từ CV thật)')
process.exit(failed > 0 || partial > 0 ? 1 : 0)
