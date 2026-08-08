import type { ChatProvider, ChatRequest, ChatResponse, ProviderKind } from '../types.js'
import { GatewayError } from '../types.js'

export interface OpenAICompatibleOptions {
  baseUrl: string
  apiKeyEnv: string
  modelId: string
  kind: Extract<ProviderKind, 'openai' | 'deepseek'>
  /** DeepSeek V4 currently accepts JSON mode; OpenAI accepts JSON schema. */
  structuredOutput: 'json_schema' | 'json_object'
}

interface CompletionResponse {
  choices?: { message?: { content?: string }; delta?: { content?: string } }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  error?: unknown
}

/** Adapter for providers exposing the OpenAI-compatible chat completions API. */
export class OpenAICompatibleProvider implements ChatProvider {
  constructor(
    readonly name: string,
    private readonly opts: OpenAICompatibleOptions,
  ) {}

  get kind(): Extract<ProviderKind, 'openai' | 'deepseek'> {
    return this.opts.kind
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const apiKey = process.env[this.opts.apiKeyEnv]
    if (!apiKey) {
      throw new GatewayError('PROVIDER_DISABLED', `${this.name}: thiếu ${this.opts.apiKeyEnv}`)
    }
    const stream = typeof req.onToken === 'function'
    const body: Record<string, unknown> = {
      model: this.opts.modelId,
      messages: req.messages,
      stream,
    }
    // GPT-5.6 only accepts its default temperature value; task temperatures
    // are still forwarded to DeepSeek-compatible models.
    if (this.opts.kind !== 'openai') body['temperature'] = req.temperature
    // GPT-5.6 rejects the legacy max_tokens parameter. DeepSeek keeps the
    // OpenAI-compatible max_tokens spelling.
    body[this.opts.kind === 'openai' ? 'max_completion_tokens' : 'max_tokens'] = req.maxTokens
    if (req.jsonSchema) {
      body['response_format'] =
        this.opts.structuredOutput === 'json_schema'
          ? { type: 'json_schema', json_schema: req.jsonSchema }
          : { type: 'json_object' }
    }
    const res = await this.request(body, req.signal)
    if (!stream) return this.parse(await res.json())
    return this.readStream(res, req.onToken!)
  }

  async countTokens(text: string): Promise<number> {
    // Cloud APIs do not expose the local /tokenize endpoint. This conservative
    // estimate is only used for budget fitting; provider billing uses server usage.
    return Math.ceil(text.length / 3.5)
  }

  async health(): Promise<boolean> {
    const key = process.env[this.opts.apiKeyEnv]
    if (!key) return false
    try {
      const res = await fetch(`${this.opts.baseUrl.replace(/\/$/, '')}/models`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(3_000),
      })
      return res.ok
    } catch {
      return false
    }
  }

  private async request(body: unknown, signal?: AbortSignal): Promise<Response> {
    let res: Response
    try {
      res = await fetch(`${this.opts.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env[this.opts.apiKeyEnv]}`,
        },
        body: JSON.stringify(body),
        signal,
      })
    } catch (err) {
      throw new GatewayError('MODEL_UNAVAILABLE', `${this.name}: ${(err as Error).message}`, err)
    }
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300)
      const code =
        res.status === 429
          ? 'RATE_LIMITED'
          : res.status === 400
            ? 'BAD_INPUT'
            : res.status === 401 || res.status === 403
              ? 'PROVIDER_DISABLED'
              : 'MODEL_UNAVAILABLE'
      throw new GatewayError(code, `${this.name}: HTTP ${res.status} ${detail}`)
    }
    return res
  }

  private parse(json: CompletionResponse): ChatResponse {
    if (json.error) throw new GatewayError('UNKNOWN', `${this.name}: ${JSON.stringify(json.error).slice(0, 300)}`)
    return {
      text: json.choices?.[0]?.message?.content ?? '',
      promptTokens: json.usage?.prompt_tokens ?? 0,
      completionTokens: json.usage?.completion_tokens ?? 0,
    }
  }

  private async readStream(res: Response, onToken: (chunk: string) => void): Promise<ChatResponse> {
    if (!res.body) throw new GatewayError('UNKNOWN', `${this.name}: stream rỗng`)
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let text = ''
    let promptTokens = 0
    let completionTokens = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const payload = line.trim().startsWith('data:') ? line.trim().slice(5).trim() : ''
        if (!payload || payload === '[DONE]') continue
        try {
          const chunk = JSON.parse(payload) as CompletionResponse
          const delta = chunk.choices?.[0]?.delta?.content
          if (delta) { text += delta; onToken(delta) }
          promptTokens = chunk.usage?.prompt_tokens ?? promptTokens
          completionTokens = chunk.usage?.completion_tokens ?? completionTokens
        } catch { /* ignore malformed SSE lines */ }
      }
    }
    return { text, promptTokens, completionTokens }
  }
}
