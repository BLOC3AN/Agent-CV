#!/usr/bin/env tsx
/**
 * Kiểm kê bộ CV — sinh lại bảng trong eval/cv/INVENTORY.md từ file thật.
 *
 * KHÔNG in PII: chỉ đếm và phân loại, không in nội dung.
 * Cần: python3 + PyMuPDF (fitz) + poppler-utils (pdftotext) — đều đã có sẵn.
 *
 * Chạy: npx tsx eval/inspect-cv.ts
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const CV_DIR = join(dirname(fileURLToPath(import.meta.url)), 'cv')

const PY = String.raw`
import fitz, os, re, subprocess, json, sys

GARBLE = re.compile(r'[ˇ˘˙˚˛˜˝ﬁﬂ]|(?<=[a-z])[A-Z]{2}(?=[a-z])')
VI = re.compile(r'\b(kinh nghiệm|học vấn|dự án|kỹ năng|mục tiêu|trường|tốt nghiệp|hoạt động)\b', re.I)
EN = re.compile(r'\b(experience|education|projects?|skills|objective|summary|university|activities)\b', re.I)
ICON = re.compile(r'(fontawesome|awesome|icomoon|glyphicon|feather|symbol|wingding)', re.I)

def cols(page):
    bl = [b for b in page.get_text("blocks") if b[6] == 0]
    if not bl: return 0
    W = page.rect.width
    l = sum(1 for b in bl if b[0] < W*0.45)
    r = sum(1 for b in bl if b[0] > W*0.5)
    return 2 if (l >= 3 and r >= 3) else 1

out = []
for f in sorted(os.listdir(sys.argv[1])):
    if not f.lower().endswith('.pdf'): continue
    p = os.path.join(sys.argv[1], f)
    d = fitz.open(p)
    txt = "".join(pg.get_text() for pg in d)
    fonts = sorted({s['font'] for pg in d for b in pg.get_text('dict')['blocks']
                    for l in b.get('lines',[]) for s in l['spans']})
    pop = subprocess.run(['pdftotext', p, '-'], capture_output=True, text=True).stdout
    a, b = re.sub(r'\s+',' ',txt).strip(), re.sub(r'\s+',' ',pop).strip()
    diff = abs(len(a)-len(b))/max(len(a),len(b),1)
    type3 = any(fnt.startswith('Type3') for fnt in fonts)
    garble = len(GARBLE.findall(a)) + len(GARBLE.findall(b))

    if len(a) < 200 and len(b) < 200: quality = 'none'
    elif type3 or garble > 0 or diff > 0.15:  quality = 'suspect'
    else: quality = 'good'

    out.append(dict(
        id=f.replace('.pdf',''), pages=d.page_count, chars=len(a),
        cols=max(cols(pg) for pg in d),
        lang='vi' if len(VI.findall(txt)) >= len(EN.findall(txt)) else 'en',
        images=sum(len(pg.get_images()) for pg in d),
        fontCount=len(fonts), type3=type3,
        iconFont=any(ICON.search(x) for x in fonts),
        garble=garble, engineDiff=round(diff,3), quality=quality,
    ))
    d.close()
print(json.dumps(out, ensure_ascii=False))
`

interface Row {
  id: string; pages: number; chars: number; cols: number; lang: string
  images: number; fontCount: number; type3: boolean; iconFont: boolean
  garble: number; engineDiff: number; quality: 'good' | 'suspect' | 'none'
}

if (!existsSync(CV_DIR) || readdirSync(CV_DIR).filter((f) => f.endsWith('.pdf')).length === 0) {
  console.error(`Không có PDF nào trong ${CV_DIR}`)
  process.exit(1)
}

const rows: Row[] = JSON.parse(
  execFileSync('python3', ['-c', PY, CV_DIR], { encoding: 'utf8', maxBuffer: 1 << 24 }),
)

const pad = (s: string | number, n: number) => String(s).padEnd(n)
const rpad = (s: string | number, n: number) => String(s).padStart(n)

console.log(
  `\n${pad('ID', 8)} ${rpad('TRANG', 5)} ${rpad('CỘT', 3)} ${rpad('KÝ TỰ', 6)} ` +
  `${pad('NGÔN NGỮ', 8)} ${rpad('FONT', 4)} ${pad('TYPE3', 5)} ${pad('ICON', 4)} ` +
  `${rpad('LỖI', 3)} ${pad('CHẤT LƯỢNG', 10)}`,
)
console.log('─'.repeat(70))
for (const r of rows) {
  console.log(
    `${pad(r.id, 8)} ${rpad(r.pages, 5)} ${rpad(r.cols, 3)} ${rpad(r.chars, 6)} ` +
    `${pad(r.lang, 8)} ${rpad(r.fontCount, 4)} ${pad(r.type3 ? 'CÓ' : '-', 5)} ` +
    `${pad(r.iconFont ? 'CÓ' : '-', 4)} ${rpad(r.garble, 3)} ${pad(r.quality, 10)}`,
  )
}

// Tổng hợp — dùng để cảnh báo khoảng trống trong bộ eval
const byQuality = rows.reduce<Record<string, number>>((a, r) => {
  a[r.quality] = (a[r.quality] ?? 0) + 1
  return a
}, {})
const vi = rows.filter((r) => r.lang === 'vi').length
const twoCol = rows.filter((r) => r.cols === 2).length

console.log(`\nTổng: ${rows.length} CV · chất lượng ${JSON.stringify(byQuality)}`)
console.log(`Tiếng Việt: ${vi}/${rows.length} · 2 cột: ${twoCol}/${rows.length}`)

const gaps: string[] = []
if (vi === 0) gaps.push('KHÔNG có CV tiếng Việt — đối tượng chính của sản phẩm')
if (!byQuality['none']) gaps.push('Chưa có CV scan (không text layer) — CV-03')
if (twoCol === 0) gaps.push('Chưa có CV 2 cột — CV-02')
if (gaps.length) {
  console.log('\n⚠  Khoảng trống:')
  for (const g of gaps) console.log(`   · ${g}`)
}
