import type { AppConfig } from '../config.js'
import { loadConfig, modelBaseUrl } from '../config.js'
import type { ChatProvider, EmbedProvider, RerankProvider } from '../types.js'
import { GatewayError } from '../types.js'
import { LlamaCppProvider } from './llamacpp.js'
import { BgeEmbedProvider, BgeRerankProvider } from './bge.js'
import { AnthropicProvider } from './anthropic.js'

export { LlamaCppProvider } from './llamacpp.js'
export { BgeEmbedProvider, BgeRerankProvider } from './bge.js'
export { AnthropicProvider } from './anthropic.js'

/**
 * Registry provider — dựng từ config.yml.
 *
 * TDD A6: code nghiệp vụ KHÔNG BAO GIỜ import provider trực tiếp.
 * Chỉ gateway được phép chạm vào registry này.
 */
export class ProviderRegistry {
  private chats = new Map<string, ChatProvider>()
  private embedder: EmbedProvider | null = null
  private reranker: RerankProvider | null = null

  constructor(private readonly cfg: AppConfig = loadConfig()) {
    this.build()
  }

  private build(): void {
    const local = this.cfg.providers.local
    if (local.enabled) {
      for (const [alias, m] of Object.entries(local.models)) {
        if (alias === 'embedder' || alias === 'reranker') continue
        this.chats.set(
          `local.${alias}`,
          new LlamaCppProvider(`local.${alias}`, {
            baseUrl: modelBaseUrl(this.cfg, alias),
            ...(m.model_id ? { modelId: m.model_id } : {}),
            connectTimeoutMs: this.cfg.policies.defaults.connect_timeout_ms,
          }),
        )
      }
      if (local.models['embedder']) {
        this.embedder = new BgeEmbedProvider({
          baseUrl: modelBaseUrl(this.cfg, 'embedder'),
        })
      }
      if (local.models['reranker']) {
        this.reranker = new BgeRerankProvider({
          baseUrl: modelBaseUrl(this.cfg, 'reranker'),
        })
      }
    }

    const anthro = this.cfg.providers.anthropic
    for (const [alias, m] of Object.entries(anthro.models)) {
      this.chats.set(
        `anthropic.${alias}`,
        new AnthropicProvider(`anthropic.${alias}`, {
          enabled: anthro.enabled,
          modelId: m.model_id,
          apiKeyEnv: anthro.api_key_env,
          ...(typeof m['effort'] === 'string'
            ? { effort: m['effort'] as 'low' | 'medium' | 'high' | 'xhigh' | 'max' }
            : {}),
        }),
      )
    }
  }

  chat(ref: string): ChatProvider {
    const p = this.chats.get(ref)
    if (!p) {
      throw new GatewayError(
        'MODEL_UNAVAILABLE',
        `Chưa đăng ký chat provider "${ref}". Có: [${[...this.chats.keys()].join(', ')}]`,
      )
    }
    return p
  }

  /** Cho phép test thay provider bằng mock ở ĐÚNG tầng này (TESTCASES §1.4) */
  registerChat(ref: string, provider: ChatProvider): void {
    this.chats.set(ref, provider)
  }

  embed(): EmbedProvider {
    if (!this.embedder) {
      throw new GatewayError('MODEL_UNAVAILABLE', 'Chưa cấu hình embedder')
    }
    return this.embedder
  }

  rerank(): RerankProvider {
    if (!this.reranker) {
      throw new GatewayError('MODEL_UNAVAILABLE', 'Chưa cấu hình reranker')
    }
    return this.reranker
  }

  registerEmbed(p: EmbedProvider): void {
    this.embedder = p
  }

  registerRerank(p: RerankProvider): void {
    this.reranker = p
  }

  listChatRefs(): string[] {
    return [...this.chats.keys()]
  }

  /** Health toàn cụm — dùng cho /api/health và banner degrade (UC-71) */
  async healthAll(): Promise<Record<string, boolean>> {
    const out: Record<string, boolean> = {}
    await Promise.all(
      [...this.chats.entries()].map(async ([ref, p]) => {
        if (ref.startsWith('anthropic.')) return
        out[ref] = await p.health()
      }),
    )
    if (this.embedder) out['local.embedder'] = await this.embedder.health()
    if (this.reranker) out['local.reranker'] = await this.reranker.health()
    return out
  }
}
