import type {
  ChatProvider,
  ChatRequest,
  ChatResponse,
  ProviderKind,
} from '../types.js'
import { GatewayError } from '../types.js'

/**
 * Anthropic provider — STUB, TẮT ở giai đoạn 1 (config.yml: enabled: false).
 *
 * Tồn tại để chứng minh kiến trúc cloud-ready thật (TDD A6): bật cloud sau gọi
 * vốn chỉ cần sửa `config.yml`, KHÔNG sửa code nghiệp vụ. Khi bật, chỉ cần cài
 * `@anthropic-ai/sdk` và điền phần `chat()` bên dưới.
 *
 * ⚠️ Ràng buộc BẤT BIẾN khi bật (TDD §15.2 R2):
 *    Task có `required_local: true` (redact_pii, embed_text) KHÔNG BAO GIỜ
 *    được định tuyến tới đây. Gateway đã chặn ở tầng routing — xem
 *    resolveRoute() trong gateway.ts và test TC-SEC-03.
 */

export interface AnthropicOptions {
  enabled: boolean
  modelId: string
  apiKeyEnv: string
  /** adaptive thinking + effort — TDD §3.2 */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  maxTokens?: number
}

export class AnthropicProvider implements ChatProvider {
  readonly kind: ProviderKind = 'anthropic'

  constructor(
    readonly name: string,
    private readonly opts: AnthropicOptions,
  ) {}

  get enabled(): boolean {
    return this.opts.enabled
  }

  async chat(_req: ChatRequest): Promise<ChatResponse> {
    if (!this.opts.enabled) {
      throw new GatewayError(
        'PROVIDER_DISABLED',
        `Provider anthropic đang tắt (config.yml → providers.anthropic.enabled: false). ` +
          `Giai đoạn 1 chạy 100% local, chi phí LLM = $0.`,
      )
    }
    // Khi bật: cài @anthropic-ai/sdk rồi hiện thực ở đây.
    //   const client = new Anthropic({ apiKey: process.env[this.opts.apiKeyEnv] })
    //   const res = await client.messages.create({
    //     model: this.opts.modelId,
    //     max_tokens: _req.maxTokens,
    //     thinking: { type: 'adaptive' },
    //     output_config: { effort: this.opts.effort ?? 'high' },
    //     system: <section system>,
    //     messages: <phần còn lại>,
    //   })
    // Lưu ý khi hiện thực:
    //   · Đặt cache_control sau [profile][jd], trước [kb][câu hỏi] (TDD §6.6)
    //   · Dùng output_config.format thay cho mọi regex bóc JSON
    //   · KHÔNG dùng assistant prefill (400 trên model 5.x)
    throw new GatewayError(
      'PROVIDER_DISABLED',
      'AnthropicProvider chưa được hiện thực — xem hướng dẫn trong file này.',
    )
  }

  async countTokens(text: string): Promise<number> {
    // Khi bật: dùng client.messages.countTokens (KHÔNG dùng tiktoken).
    // Tạm thời ước lượng thô để budget manager không vỡ nếu ai đó bật nhầm.
    if (!this.opts.enabled) {
      throw new GatewayError('PROVIDER_DISABLED', 'anthropic đang tắt')
    }
    return Math.ceil(text.length / 3.5)
  }

  async health(): Promise<boolean> {
    return this.opts.enabled && Boolean(process.env[this.opts.apiKeyEnv])
  }
}
