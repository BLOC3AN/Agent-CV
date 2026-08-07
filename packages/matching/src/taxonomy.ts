import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { containsPhrase, normalize } from './normalize.js'

/**
 * Phân loại kỹ năng — TDD §9.2, lớp 1 của §8.2.
 *
 * Bài toán: JD viết "ReactJS", CV viết "React.js", ATS viết "React". Không
 * chuẩn hoá thì lớp keyword báo "thiếu React" trên một CV đầy React, và toàn
 * bộ phân tích phía sau sai theo.
 */

const SkillSchema = z.object({
  canonical: z.string().min(1),
  display: z.object({ vi: z.string(), en: z.string() }),
  kind: z.enum(['language', 'framework', 'database', 'tool', 'platform', 'practice', 'soft']),
  aliases: z.array(z.string()).default([]),
  parent: z.string().optional(),
  weight: z.number().min(0).max(2).default(1),
})

const FileSchema = z.object({
  version: z.number(),
  industry: z.string(),
  skills: z.array(SkillSchema).min(1),
})

export type SkillKind = z.infer<typeof SkillSchema>['kind']
export type SkillEntry = z.infer<typeof SkillSchema>

export interface SkillHit {
  canonical: string
  display: { vi: string; en: string }
  kind: SkillKind
  weight: number
  /** Chuỗi thật trong text đã làm nó khớp — dùng để giải thích cho user */
  matchedAs: string
}

const DEFAULT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../kb/taxonomy/it-software.yaml',
)

export class SkillTaxonomy {
  private readonly byCanonical = new Map<string, SkillEntry>()
  /** alias đã chuẩn hoá → canonical. Một alias chỉ thuộc về một kỹ năng. */
  private readonly aliasIndex = new Map<string, string>()
  /** Sắp giảm dần theo độ dài: khớp cụm dài trước ("spring boot" trước "spring") */
  private readonly aliasesByLength: string[] = []

  constructor(entries: SkillEntry[]) {
    for (const e of entries) {
      this.byCanonical.set(e.canonical, e)
      // Chính tên canonical và display cũng là alias — người ta gõ đúng tên
      // thật nhiều hơn gõ biến thể
      const all = new Set([e.canonical, e.display.vi, e.display.en, ...e.aliases])
      for (const a of all) {
        const n = normalize(a)
        if (!n) continue
        // Alias trùng giữa hai kỹ năng: giữ cái đăng ký TRƯỚC. Ghi đè âm thầm
        // sẽ làm kết quả phụ thuộc thứ tự dòng trong file YAML.
        if (!this.aliasIndex.has(n)) {
          this.aliasIndex.set(n, e.canonical)
          this.aliasesByLength.push(n)
        }
      }
    }
    this.aliasesByLength.sort((a, b) => b.length - a.length)
  }

  static load(path = DEFAULT_PATH): SkillTaxonomy {
    const raw = parseYaml(readFileSync(path, 'utf8')) as unknown
    return new SkillTaxonomy(FileSchema.parse(raw).skills)
  }

  get size(): number {
    return this.byCanonical.size
  }

  entry(canonical: string): SkillEntry | undefined {
    return this.byCanonical.get(canonical)
  }

  all(): SkillEntry[] {
    return [...this.byCanonical.values()]
  }

  /**
   * Một chuỗi ngắn (một mục trong danh sách kỹ năng) → canonical.
   *
   * Thử khớp CHÍNH XÁC trước, rồi mới khớp chứa. "React 18" không khớp chính
   * xác nhưng chứa "react" — vẫn phải nhận ra.
   */
  canonicalize(text: string): SkillHit | null {
    const n = normalize(text)
    if (!n) return null

    const exact = this.aliasIndex.get(n)
    if (exact) return this.hit(exact, n)

    for (const alias of this.aliasesByLength) {
      if (containsPhrase(n, alias)) return this.hit(this.aliasIndex.get(alias)!, alias)
    }
    return null
  }

  /**
   * Quét cả đoạn văn, trả về mọi kỹ năng nhận ra.
   *
   * Duyệt alias từ DÀI tới NGẮN và xoá phần đã khớp khỏi text: nếu không,
   * "spring boot" sẽ được tính cả thành `spring` lẫn (nếu có) `boot`, và một
   * kỹ năng bị đếm hai lần.
   */
  extract(text: string): SkillHit[] {
    let hay = ` ${normalize(text)} `
    const found = new Map<string, SkillHit>()

    for (const alias of this.aliasesByLength) {
      if (!containsPhrase(hay, alias)) continue
      const canonical = this.aliasIndex.get(alias)!
      if (!found.has(canonical)) found.set(canonical, this.hit(canonical, alias))
      // Thay bằng khoảng trắng, không xoá hẳn: xoá sẽ dán hai từ kề nhau lại
      // thành một token không có thật
      hay = hay.split(alias).join(' ')
    }
    return [...found.values()]
  }

  /**
   * Kỹ năng cha, đệ quy. Biết Next.js nghĩa là biết React và JavaScript —
   * JD tuyển React mà CV chỉ ghi Next.js thì vẫn phải tính là khớp.
   */
  ancestors(canonical: string): string[] {
    const out: string[] = []
    const seen = new Set<string>([canonical])
    let cur = this.byCanonical.get(canonical)?.parent
    while (cur && !seen.has(cur)) {
      out.push(cur)
      seen.add(cur)
      cur = this.byCanonical.get(cur)?.parent
    }
    return out
  }

  /** Mở rộng một tập canonical bằng toàn bộ tổ tiên của chúng. */
  withAncestors(canonicals: Iterable<string>): Set<string> {
    const out = new Set<string>()
    for (const c of canonicals) {
      out.add(c)
      for (const a of this.ancestors(c)) out.add(a)
    }
    return out
  }

  private hit(canonical: string, matchedAs: string): SkillHit {
    const e = this.byCanonical.get(canonical)!
    return {
      canonical,
      display: e.display,
      kind: e.kind,
      weight: e.weight,
      matchedAs,
    }
  }
}

/** Bản dùng chung — đọc file YAML một lần cho cả tiến trình. */
let shared: SkillTaxonomy | null = null
export function taxonomy(path?: string): SkillTaxonomy {
  if (!shared || path) {
    const t = SkillTaxonomy.load(path)
    if (!path) shared = t
    return t
  }
  return shared
}
