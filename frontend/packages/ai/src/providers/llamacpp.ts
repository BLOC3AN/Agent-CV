import type {
  ChatProvider,
  ChatRequest,
  ChatResponse,
  ProviderKind,
} from '../types.js'
import { GatewayError } from '../types.js'

/**
 * Adapter cho llama.cpp server (OpenAI-compatible) — TDD §5.4.
 * Dùng cho: reasoner :5011 · generalist :5010 · ocr :5012 · classifier :5013
 *
 * Ngoài /v1/chat/completions còn dùng:
 *   · POST /tokenize  → đếm token thật cho budget manager (TDD §6.3)
 *   · GET  /props     → xác minh n_ctx chưa đổi (TC-INT-03)
 */

export interface LlamaCppOptions {
  baseUrl: string
  modelId?: string
  connectTimeoutMs?: number
}

interface OpenAIChatChoice {
  message?: { content?: string }
  delta?: { content?: string }
  finish_reason?: string
}

interface OpenAIChatResponse {
  choices?: OpenAIChatChoice[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  error?: unknown
}

export class LlamaCppProvider implements ChatProvider {
  readonly kind: ProviderKind = 'local'

  constructor(
    readonly name: string,
    private readonly opts: LlamaCppOptions,
  ) {}

  get baseUrl(): string {
    return this.opts.baseUrl
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const stream = typeof req.onToken === 'function'
    const body: Record<string, unknown> = {
      messages: req.messages,
      max_tokens: req.maxTokens,
      temperature: req.temperature,
      stream,
    }
    if (this.opts.modelId) body['model'] = this.opts.modelId

    // Constrained decoding — llama.cpp dựng GBNF grammar từ JSON Schema và ép
    // sinh token theo đó. Không có nó, model 4B trả JSON hỏng thường xuyên
    // (đo được: escalate 100% trên schema 12 field). Xác minh hỗ trợ: TC-INT-06.
    if (req.jsonSchema) {
      body['response_format'] = {
        type: 'json_schema',
        json_schema: { name: req.jsonSchema.name, schema: req.jsonSchema.schema },
      }
    }

    // KHÔNG áp connectTimeoutMs cho chat: đó là timeout kết nối, không phải
    // timeout toàn cuộc gọi. Sinh 3500 token ở 35 tok/s mất ~100s — áp 3s vào
    // đây thì mọi task sinh dài đều chết. Timeout tổng do gateway kiểm soát qua
    // `req.signal` (withTimeout ở policies.ts).
    const res = await this.post('/v1/chat/completions', body, req.signal, 0)

    if (!stream) {
      const json = (await res.json()) as OpenAIChatResponse
      if (json.error) {
        throw new GatewayError(
          'UNKNOWN',
          `${this.name}: ${JSON.stringify(json.error).slice(0, 300)}`,
        )
      }
      const text = json.choices?.[0]?.message?.content ?? ''
      return {
        text,
        promptTokens: json.usage?.prompt_tokens ?? 0,
        completionTokens: json.usage?.completion_tokens ?? 0,
      }
    }

    return this.readStream(res, req.onToken!)
  }

  /** SSE của llama.cpp: `data: {...}` từng dòng, kết thúc bằng `data: [DONE]` */
  private async readStream(
    res: Response,
    onToken: (chunk: string) => void,
  ): Promise<ChatResponse> {
    if (!res.body) throw new GatewayError('UNKNOWN', `${this.name}: stream rỗng`)
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let text = ''
    let promptTokens = 0
    let completionTokens = 0

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const t = line.trim()
        if (!t.startsWith('data:')) continue
        const payload = t.slice(5).trim()
        if (payload === '[DONE]') continue
        try {
          const json = JSON.parse(payload) as OpenAIChatResponse
          const delta = json.choices?.[0]?.delta?.content
          if (delta) {
            text += delta
            onToken(delta)
          }
          if (json.usage?.prompt_tokens) promptTokens = json.usage.prompt_tokens
          if (json.usage?.completion_tokens)
            completionTokens = json.usage.completion_tokens
        } catch {
          // bỏ qua dòng không parse được, stream vẫn tiếp tục
        }
      }
    }
    return { text, promptTokens, completionTokens }
  }

  /**
   * TDD §6.3 — đếm token bằng chính tokenizer của model.
   * KHÔNG ước lượng text.length / 4: tiếng Việt lệch 1.29× so với tiếng Anh.
   */
  async countTokens(text: string): Promise<number> {
    const res = await this.post('/tokenize', { content: text })
    const json = (await res.json()) as { tokens?: unknown[] }
    if (!Array.isArray(json.tokens)) {
      throw new GatewayError('UNKNOWN', `${this.name}: /tokenize trả về sai định dạng`)
    }
    return json.tokens.length
  }

  /** Đọc n_ctx thực tế của server — TC-INT-03 dùng để cảnh báo sớm */
  async props(): Promise<{ nCtx: number | null; totalSlots: number | null; modelPath: string }> {
    const res = await this.get('/props')
    const json = (await res.json()) as Record<string, unknown>
    const gen = json['default_generation_settings'] as Record<string, unknown> | undefined
    return {
      nCtx: typeof gen?.['n_ctx'] === 'number' ? (gen['n_ctx'] as number) : null,
      totalSlots:
        typeof json['total_slots'] === 'number' ? (json['total_slots'] as number) : null,
      modelPath: String(json['model_path'] ?? ''),
    }
  }

  async health(): Promise<boolean> {
    try {
      const res = await this.get('/v1/models', 3_000)
      return res.ok
    } catch {
      return false
    }
  }

  // ── HTTP ──────────────────────────────────────────────────────────────────

  private async get(path: string, timeoutMs?: number): Promise<Response> {
    return this.request('GET', path, undefined, undefined, timeoutMs)
  }

  private async post(
    path: string,
    body: unknown,
    signal?: AbortSignal,
    timeoutMs?: number,
  ): Promise<Response> {
    return this.request('POST', path, body, signal, timeoutMs)
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
    timeoutMs?: number,
  ): Promise<Response> {
    const ac = new AbortController()
    // timeoutMs === 0 → không đặt timeout ở tầng provider (gateway lo qua signal)
    const t = timeoutMs === 0 ? undefined : (timeoutMs ?? this.opts.connectTimeoutMs)
    const timer = t ? setTimeout(() => ac.abort(), t) : undefined
    const onAbort = () => ac.abort(signal?.reason)
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const res = await fetch(`${this.opts.baseUrl}${path}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: ac.signal,
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new GatewayError(
          res.status === 429 ? 'RATE_LIMITED' : 'MODEL_UNAVAILABLE',
          `${this.name} ${method} ${path} → HTTP ${res.status} ${detail.slice(0, 200)}`,
        )
      }
      return res
    } catch (err) {
      if (err instanceof GatewayError) throw err
      const name = (err as { name?: string })?.name
      throw new GatewayError(
        name === 'AbortError' || name === 'TimeoutError' ? 'TIMEOUT' : 'MODEL_UNAVAILABLE',
        `${this.name} ${method} ${path}: ${(err as Error).message}`,
        err,
      )
    } finally {
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }
}
