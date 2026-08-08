import type { EmbedProvider, RerankProvider, RerankResult } from '../types.js'
import { GatewayError } from '../types.js'

/**
 * Adapter cho embedder & reranker — TDD §5.4.
 *
 * ⚠️ Bẫy đã gặp khi khảo sát server (ghi lại để khỏi mắc lại):
 *   ❌ POST :8003/v1/embeddings           → 404 (KHÔNG phải OpenAI API)
 *   ❌ POST :8003/embed {"texts":[...]}   → 422 missing field "text"
 *   ✅ POST :8003/embed {"text":"..."}    → {success, dense_vector[1024], ...}
 *   ✅ POST :8003/embed-batch             → dạng batch
 *   ✅ POST :5014/v1/rerank               → relevance_score là LOGIT, có thể ÂM
 */

// ── Embedder :8003 — API riêng, KHÔNG chuẩn OpenAI ──────────────────────────

export interface BgeEmbedOptions {
  baseUrl: string
  timeoutMs?: number
}

interface EmbedResponse {
  success?: boolean
  dense_vector?: number[]
  sparse?: unknown
}

export class BgeEmbedProvider implements EmbedProvider {
  readonly name = 'local.embedder'
  readonly dimensions = 1024

  constructor(private readonly opts: BgeEmbedOptions) {}

  async embed(text: string): Promise<number[]> {
    // Field là "text" (SỐ ÍT). "texts" sẽ trả 422.
    const json = await this.post<EmbedResponse>('/embed', { text })
    const v = json.dense_vector
    if (!Array.isArray(v) || v.length !== this.dimensions) {
      throw new GatewayError(
        'UNKNOWN',
        `embedder trả về ${Array.isArray(v) ? v.length : 'không phải mảng'} chiều, ` +
          `kỳ vọng ${this.dimensions}. Chiều vector đổi → index pgvector hỏng (TC-INT-04).`,
      )
    }
    return v
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []
    try {
      const json = await this.post<{ dense_vectors?: number[][]; results?: EmbedResponse[] }>(
        '/embed-batch',
        { texts },
      )
      if (Array.isArray(json.dense_vectors)) return json.dense_vectors
      if (Array.isArray(json.results)) {
        return json.results.map((r) => r.dense_vector ?? [])
      }
    } catch {
      // Endpoint batch có thể đổi shape — lùi về gọi tuần tự, chậm nhưng đúng
    }
    const out: number[][] = []
    for (const t of texts) out.push(await this.embed(t))
    return out
  }

  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.opts.baseUrl}/health`, {
        signal: AbortSignal.timeout(3_000),
      })
      return res.ok
    } catch {
      return false
    }
  }

  /** Dùng cho TC-INT-04: xác minh model & chiều vector chưa đổi */
  async modelInfo(): Promise<{ name: string; dimension: number; hybridReady: boolean }> {
    const json = await this.get<{
      dense_model?: { name?: string; dimension?: number }
      hybrid_ready?: boolean
    }>('/model-info')
    return {
      name: json.dense_model?.name ?? '',
      dimension: json.dense_model?.dimension ?? 0,
      hybridReady: Boolean(json.hybrid_ready),
    }
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.opts.baseUrl}${path}`, {
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 15_000),
    })
    if (!res.ok) {
      throw new GatewayError('MODEL_UNAVAILABLE', `embedder GET ${path} → ${res.status}`)
    }
    return (await res.json()) as T
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    let res: Response
    try {
      res = await fetch(`${this.opts.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 15_000),
      })
    } catch (err) {
      const name = (err as { name?: string })?.name
      throw new GatewayError(
        name === 'TimeoutError' ? 'TIMEOUT' : 'MODEL_UNAVAILABLE',
        `embedder POST ${path}: ${(err as Error).message}`,
        err,
      )
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new GatewayError(
        'MODEL_UNAVAILABLE',
        `embedder POST ${path} → ${res.status} ${detail.slice(0, 200)}`,
      )
    }
    return (await res.json()) as T
  }
}

// ── Reranker :5014 — cross-encoder ──────────────────────────────────────────

export interface BgeRerankOptions {
  baseUrl: string
  timeoutMs?: number
}

export class BgeRerankProvider implements RerankProvider {
  readonly name = 'local.reranker'

  constructor(private readonly opts: BgeRerankOptions) {}

  /**
   * ⚠️ `relevance_score` là LOGIT — có thể âm (đo được: -5.26 và -7.36 cho cặp
   * liên quan/không liên quan). CHỈ so sánh tương đối, đừng lấy ngưỡng tuyệt đối.
   */
  async rerank(
    query: string,
    documents: string[],
    topN?: number,
  ): Promise<RerankResult[]> {
    if (documents.length === 0) return []
    let res: Response
    try {
      res = await fetch(`${this.opts.baseUrl}/v1/rerank`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, documents, top_n: topN ?? documents.length }),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 15_000),
      })
    } catch (err) {
      const name = (err as { name?: string })?.name
      throw new GatewayError(
        name === 'TimeoutError' ? 'TIMEOUT' : 'MODEL_UNAVAILABLE',
        `reranker: ${(err as Error).message}`,
        err,
      )
    }
    if (!res.ok) {
      throw new GatewayError('MODEL_UNAVAILABLE', `reranker → HTTP ${res.status}`)
    }
    const json = (await res.json()) as {
      results?: { index: number; relevance_score: number }[]
    }
    return (json.results ?? [])
      .map((r) => ({ index: r.index, score: r.relevance_score }))
      .sort((a, b) => b.score - a.score)
  }

  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.opts.baseUrl}/v1/models`, {
        signal: AbortSignal.timeout(3_000),
      })
      return res.ok
    } catch {
      return false
    }
  }
}
