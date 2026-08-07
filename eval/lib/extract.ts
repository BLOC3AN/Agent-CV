/**
 * Trích text từ PDF kèm CỔNG KIỂM TRA CHẤT LƯỢNG — TDD §8.1.1.
 *
 * Chạy CẢ HAI engine (PyMuPDF + poppler) rồi so sánh. Cả hai đều cục bộ, không
 * tốn LLM, nên luôn chạy cả hai thay vì tin một engine.
 *
 * Đây là nguyên mẫu của `services/pdfkit` ở M2.
 */
import { execFileSync } from 'node:child_process'

export type ExtractQuality = 'good' | 'suspect' | 'none'

export interface ExtractResult {
  text: string
  /** Engine được chọn */
  engine: 'pymupdf' | 'poppler' | 'none'
  quality: ExtractQuality
  reasons: string[]
  pages: number
  columns: number
  hasType3: boolean
  garbleCount: number
  engineDiff: number
}

const PY = String.raw`
import fitz, re, subprocess, json, sys

GARBLE = re.compile(r'[ˇ˘˙˚˛˜˝ﬁﬂ]|(?<=[a-z])[A-Z]{2}(?=[a-z])')

def cols(page):
    bl = [b for b in page.get_text("blocks") if b[6] == 0]
    if not bl: return 1
    W = page.rect.width
    l = sum(1 for b in bl if b[0] < W*0.45)
    r = sum(1 for b in bl if b[0] > W*0.5)
    return 2 if (l >= 3 and r >= 3) else 1

p = sys.argv[1]
d = fitz.open(p)
mu = "".join(pg.get_text() for pg in d)
fonts = sorted({s['font'] for pg in d for b in pg.get_text('dict')['blocks']
                for l in b.get('lines',[]) for s in l['spans']})
pop = subprocess.run(['pdftotext','-layout',p,'-'],capture_output=True,text=True).stdout

norm = lambda s: re.sub(r'[ \t]+',' ',s).strip()
a, b = norm(mu), norm(pop)
flat = lambda s: re.sub(r'\s+','',s)
diff = abs(len(flat(a))-len(flat(b)))/max(len(flat(a)),len(flat(b)),1)

print(json.dumps({
  "pymupdf": a, "poppler": b,
  "pages": d.page_count,
  "columns": max(cols(pg) for pg in d),
  "hasType3": any(f.startswith('Type3') for f in fonts),
  "garblePymupdf": len(GARBLE.findall(a)),
  "garblePoppler": len(GARBLE.findall(b)),
  "engineDiff": round(diff, 4),
}, ensure_ascii=False))
`

export function extractPdf(path: string): ExtractResult {
  const raw = JSON.parse(
    execFileSync('python3', ['-c', PY, path], { encoding: 'utf8', maxBuffer: 1 << 26 }),
  ) as {
    pymupdf: string; poppler: string; pages: number; columns: number
    hasType3: boolean; garblePymupdf: number; garblePoppler: number; engineDiff: number
  }

  const reasons: string[] = []

  // Không có text layer → đường ảnh (OCR)
  if (raw.pymupdf.length < 200 && raw.poppler.length < 200) {
    return {
      text: '', engine: 'none', quality: 'none',
      reasons: ['không có text layer'],
      pages: raw.pages, columns: raw.columns, hasType3: raw.hasType3,
      garbleCount: 0, engineDiff: raw.engineDiff,
    }
  }

  // Tín hiệu deterministic, khớp 1:1 với file hỏng trong bộ khảo sát
  if (raw.hasType3) reasons.push('có Type3 font')
  if (raw.columns >= 2) reasons.push('bố cục nhiều cột')
  if (raw.engineDiff > 0.15) reasons.push(`hai engine lệch ${(raw.engineDiff * 100).toFixed(0)}%`)

  const garbleMin = Math.min(raw.garblePymupdf, raw.garblePoppler)
  if (garbleMin > 0) reasons.push(`ký tự lỗi (ít nhất ${garbleMin})`)

  // Chọn engine ít lỗi hơn; hoà thì lấy PyMuPDF (có toạ độ, cần cho UC-22)
  const engine: 'pymupdf' | 'poppler' =
    raw.garblePoppler < raw.garblePymupdf ? 'poppler' : 'pymupdf'

  return {
    text: engine === 'poppler' ? raw.poppler : raw.pymupdf,
    engine,
    quality: reasons.length > 0 ? 'suspect' : 'good',
    reasons,
    pages: raw.pages,
    columns: raw.columns,
    hasType3: raw.hasType3,
    garbleCount: garbleMin,
    engineDiff: raw.engineDiff,
  }
}
