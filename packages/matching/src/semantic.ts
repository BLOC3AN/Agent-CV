import type { JDRequirements } from '@hr/schema'
import type { ProfileChunk } from './keyword.js'

/**
 * Lớp 2 — đối chiếu NGỮ NGHĨA. TDD §8.2.
 *
 * Lớp keyword chỉ thấy được thứ viết đúng chữ. JD hỏi *"kinh nghiệm tối ưu hiệu
 * năng"*, CV viết *"giảm thời gian phản hồi từ 800ms xuống 120ms"* — cùng một
 * điều, không chung một từ nào. Lớp này bắt những chỗ đó.
 *
 * VẪN KHÔNG DÙNG LLM SINH TEXT: embedding và rerank là phép đo, cho ra con số
 * lặp lại được. LLM chỉ diễn giải ở bước sau (quyết định D3/A4).
 *
 * Bắt buộc phải hỏng êm: embedder chết → bỏ lớp này, `degraded = true`, hệ
 * thống vẫn chấm được bằng keyword (TDD §5.5).
 */

export interface EmbedFn {
  embedBatch(texts: string[]): Promise<number[][]>
}

export interface RerankFn {
  /**
   * Trả về `{index, score}` — KHỚP với `RerankProvider` trong `@hr/ai`.
   *
   * API thô của :5014 gọi trường đó là `relevance_score`; provider đã đổi tên
   * thành `score` khi chuẩn hoá. Khai theo tên thô ở đây thì mọi điểm về
   * `undefined` mà không có lỗi nào — thứ tự vẫn đúng (do provider đã sắp sẵn)
   * nên nhìn qua tưởng chạy được.
   */
  rerank(
    query: string,
    documents: string[],
    topN?: number,
  ): Promise<{ index: number; score: number }[]>
}

export interface SemanticEvidence {
  path: string
  excerpt: string
  /** Cosine similarity, 0..1 sau khi kẹp */
  similarity: number
  /** Điểm của reranker — LOGIT, có thể ÂM. So sánh tương đối, đừng lấy ngưỡng tuyệt đối. */
  rerankScore: number | null
}

export interface SemanticMatch {
  requirement: string
  /** Bằng chứng tốt nhất, đã sắp giảm dần */
  evidence: SemanticEvidence[]
  /** Độ tương đồng cao nhất — dùng để chấm */
  best: number
  strength: 'strong' | 'moderate' | 'weak' | 'none'
}

export interface SemanticResult {
  /** 0-100, hoặc `null` khi lớp bị bỏ (embedder chết / không có yêu cầu) */
  score: number | null
  matches: SemanticMatch[]
  degraded: boolean
  degradedReason: string | null
  reranked: boolean
}

/**
 * Ngưỡng độ tương đồng.
 *
 * ĐO THẬT trên bge-m3 (`semantic.int.test.ts`), không phải ước lượng:
 *
 *   lạc đề hoàn toàn          0.32 – 0.43
 *   cùng nghĩa, khác chữ      0.48 – 0.56
 *   gần như bản dịch          0.80
 *
 * Bản đầu đoán STRONG = 0.62 — CAO HƠN mọi cặp cùng nghĩa đo được, nên không
 * bằng chứng diễn đạt lại nào đạt "strong". WEAK = 0.42 thì lại THẤP hơn cặp
 * lạc đề cao nhất (0.424), tức là nhận nhầm nội dung không liên quan.
 *
 * Ngưỡng phải đo mới biết. Đổi model hoặc phiên bản thì chạy lại phép đo đó.
 *
 * KHE HỞ HẸP: lạc đề cao nhất 0.440, cùng nghĩa thấp nhất 0.480 — chỉ 0.04.
 * Đây là giới hạn của bản thân bge-m3, không phải chỗ tinh chỉnh thêm được.
 * Vì vậy lớp ngữ nghĩa chỉ chiếm trọng số nhỏ trong điểm tổng, và bằng chứng
 * luôn hiện ra cho user tự kiểm — đừng bao giờ để nó một mình quyết định.
 *
 * KHÔNG dùng ngưỡng của reranker làm mốc tuyệt đối: nó trả logit, có thể âm,
 * và thang đo trôi theo phiên bản model (ghi trong config.yml).
 */
const STRONG = 0.6
const MODERATE = 0.52
const WEAK = 0.45

function strengthOf(sim: number): SemanticMatch['strength'] {
  if (sim >= STRONG) return 'strong'
  if (sim >= MODERATE) return 'moderate'
  if (sim >= WEAK) return 'weak'
  return 'none'
}

/** Cosine similarity. Vector của bge-m3 chưa chuẩn hoá nên phải chia chuẩn. */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    dot += x * y
    na += x * x
    nb += y * y
  }
  if (na === 0 || nb === 0) return 0
  // Kẹp về [0,1]: cosine về lý thuyết là [-1,1] nhưng embedding văn bản hiếm
  // khi âm, và điểm âm không có ý nghĩa nào cho "mức độ liên quan"
  return Math.max(0, Math.min(1, dot / (Math.sqrt(na) * Math.sqrt(nb))))
}

function excerpt(s: string, max = 140): string {
  const t = s.trim()
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`
}

/**
 * Chỉ những đoạn ĐÁNG so khớp ngữ nghĩa.
 *
 * Bỏ đoạn quá ngắn: một dòng "React" không mang ngữ nghĩa gì thêm so với lớp
 * keyword, mà vẫn tốn một lượt embed và làm loãng kết quả rerank.
 */
export function meaningfulChunks(chunks: ProfileChunk[], minChars = 25): ProfileChunk[] {
  return chunks.filter((c) => c.text.trim().length >= minChars)
}

export interface SemanticOptions {
  /** Số bằng chứng giữ lại cho mỗi yêu cầu */
  topK?: number
  /** Bật rerank — chính xác hơn nhưng thêm một lượt gọi mạng cho MỖI yêu cầu */
  rerank?: boolean
  /** Chỉ rerank khi cosine đã đủ gần; rerank cả trăm đoạn lạc đề là phí */
  rerankCandidates?: number
}

/**
 * Chấm lớp ngữ nghĩa.
 *
 * Embed TẤT CẢ trong hai lượt batch (yêu cầu + đoạn CV) chứ không lặp từng
 * cặp: một CV 30 đoạn × một JD 20 yêu cầu = 600 lượt gọi nếu làm ngây thơ.
 */
export async function scoreSemantic(
  chunks: ProfileChunk[],
  jd: JDRequirements,
  embedder: EmbedFn | null,
  reranker: RerankFn | null = null,
  opts: SemanticOptions = {},
): Promise<SemanticResult> {
  const topK = opts.topK ?? 3
  const rerankCandidates = opts.rerankCandidates ?? 8

  const requirements = [...jd.hardSkills, ...jd.responsibilities].filter((r) => r.trim())
  const usable = meaningfulChunks(chunks)

  if (!embedder) {
    return {
      score: null,
      matches: [],
      degraded: true,
      degradedReason: 'Chưa dùng được phân tích ngữ nghĩa — dịch vụ nhúng không phản hồi.',
      reranked: false,
    }
  }
  if (requirements.length === 0 || usable.length === 0) {
    return {
      score: null,
      matches: [],
      degraded: false,
      degradedReason: null,
      reranked: false,
    }
  }

  let reqVecs: number[][]
  let chunkVecs: number[][]
  try {
    // Hai lượt batch, không phải tích Descartes
    ;[reqVecs, chunkVecs] = await Promise.all([
      embedder.embedBatch(requirements),
      embedder.embedBatch(usable.map((c) => c.text)),
    ])
  } catch (err) {
    // Suy giảm, KHÔNG sập: lớp keyword vẫn cho ra điểm dùng được (TDD §5.5)
    return {
      score: null,
      matches: [],
      degraded: true,
      degradedReason: `Chưa dùng được phân tích ngữ nghĩa: ${(err as Error).message}`,
      reranked: false,
    }
  }

  const matches: SemanticMatch[] = []
  let rerankFailed = false

  for (const [i, requirement] of requirements.entries()) {
    const rv = reqVecs[i]
    if (!rv) continue

    const scored = usable
      .map((c, j) => ({ chunk: c, sim: cosine(rv, chunkVecs[j] ?? []) }))
      .sort((a, b) => b.sim - a.sim)

    let evidence: SemanticEvidence[] = scored.slice(0, topK).map((s) => ({
      path: s.chunk.path,
      excerpt: excerpt(s.chunk.text),
      similarity: Number(s.sim.toFixed(4)),
      rerankScore: null,
    }))

    // Rerank cross-encoder trên vài ứng viên đầu. Cosine đủ nhanh để lọc thô;
    // rerank chính xác hơn nhưng đắt, nên chỉ dùng ở vòng cuối.
    if (opts.rerank && reranker && !rerankFailed) {
      const candidates = scored.slice(0, rerankCandidates)
      try {
        const ranked = await reranker.rerank(
          requirement,
          candidates.map((c) => c.chunk.text),
          topK,
        )
        const mapped: (SemanticEvidence | null)[] = ranked.map((r) => {
          const c = candidates[r.index]
          if (!c) return null
          return {
            path: c.chunk.path,
            excerpt: excerpt(c.chunk.text),
            similarity: Number(c.sim.toFixed(4)),
            rerankScore: r.score,
          }
        })
        evidence = mapped.filter((x): x is SemanticEvidence => x !== null)
      } catch {
        // Reranker chết thì giữ nguyên thứ tự cosine — mất độ chính xác, không
        // mất chức năng. Đánh dấu để không thử lại cho từng yêu cầu còn lại.
        rerankFailed = true
      }
    }

    const best = evidence[0]?.similarity ?? 0
    matches.push({ requirement, evidence, best, strength: strengthOf(best) })
  }

  // Điểm = trung bình độ tương đồng tốt nhất của từng yêu cầu, quy về thang
  // 0-100 theo NGƯỠNG chứ không theo giá trị thô: cosine 0.5 không có nghĩa là
  // "khớp 50%". Ánh xạ tuyến tính từ WEAK..STRONG sang 0..100.
  const norm = (sim: number): number => {
    if (sim <= WEAK) return 0
    if (sim >= STRONG) return 100
    return Math.round(((sim - WEAK) / (STRONG - WEAK)) * 100)
  }
  const score = Math.round(matches.reduce((s, m) => s + norm(m.best), 0) / matches.length)

  return {
    score,
    matches,
    degraded: false,
    degradedReason: null,
    reranked: Boolean(opts.rerank && reranker && !rerankFailed),
  }
}
