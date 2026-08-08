import type {
  ChatProvider,
  ChatRequest,
  ChatResponse,
  ProviderKind,
} from '../src/types.js'
import { GatewayError } from '../src/types.js'

/**
 * Mock ở TẦNG PROVIDER, không mock gateway (TESTCASES §1.4).
 * Nhờ vậy gateway thật (routing, breaker, budget, validate) vẫn được test.
 */

export type MockBehavior =
  | { kind: 'ok'; payload: unknown }
  | { kind: 'text'; text: string }
  | { kind: 'schemaFail' }
  | { kind: 'invalidJson' }
  | { kind: 'down' }
  | { kind: 'timeout' }
  | { kind: 'slow'; ms: number; payload: unknown }
  | { kind: 'sequence'; steps: MockBehavior[] }

/** Sleep có thể bị huỷ — mô phỏng đúng hành vi abort của fetch */
function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new GatewayError('TIMEOUT', 'aborted trước khi bắt đầu'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new GatewayError('TIMEOUT', 'aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export class MockChatProvider implements ChatProvider {
  readonly kind: ProviderKind
  calls: ChatRequest[] = []
  tokenizeCalls = 0
  private seqIndex = 0

  constructor(
    readonly name: string,
    private behavior: MockBehavior,
    kind: ProviderKind = 'local',
    /** Số token trên mỗi ký tự — mặc định xấp xỉ tiếng Việt */
    private readonly tokensPerChar = 1 / 3,
  ) {
    this.kind = kind
  }

  setBehavior(b: MockBehavior): void {
    this.behavior = b
    this.seqIndex = 0
  }

  private nextBehavior(): MockBehavior {
    if (this.behavior.kind !== 'sequence') return this.behavior
    const steps = this.behavior.steps
    const b = steps[Math.min(this.seqIndex, steps.length - 1)]!
    this.seqIndex++
    return b
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.calls.push(req)
    const b = this.nextBehavior()
    const promptTokens = await this.countTokens(
      req.messages.map((m) => m.content).join('\n'),
    )

    switch (b.kind) {
      case 'ok':
        return { text: JSON.stringify(b.payload), promptTokens, completionTokens: 50 }
      case 'text':
        return { text: b.text, promptTokens, completionTokens: 10 }
      case 'schemaFail':
        return {
          text: JSON.stringify({ wrong: 'shape', missing: 'everything' }),
          promptTokens,
          completionTokens: 10,
        }
      case 'invalidJson':
        return { text: 'Xin chào, đây không phải JSON', promptTokens, completionTokens: 8 }
      case 'down':
        throw new GatewayError('MODEL_UNAVAILABLE', `${this.name}: ECONNREFUSED (mock)`)
      case 'timeout':
        await sleepAbortable(60_000, req.signal)
        throw new GatewayError('TIMEOUT', 'không tới đây')
      case 'slow':
        // PHẢI tôn trọng signal — fetch của provider thật cũng vậy. Mock bỏ qua
        // signal sẽ khiến test timeout luôn "pass" dù gateway không hề abort.
        await sleepAbortable(b.ms, req.signal)
        return { text: JSON.stringify(b.payload), promptTokens, completionTokens: 50 }
      default:
        throw new GatewayError('UNKNOWN', 'behavior lạ')
    }
  }

  async countTokens(text: string): Promise<number> {
    this.tokenizeCalls++
    return Math.max(1, Math.ceil(text.length * this.tokensPerChar))
  }

  async health(): Promise<boolean> {
    return this.behavior.kind !== 'down'
  }
}

/** JD hợp lệ dùng lại nhiều nơi */
export const VALID_JD = {
  title: 'Backend Developer (Fresher)',
  language: 'vi',
  roleFamily: 'backend_developer',
  seniority: 'fresher',
  domain: 'fintech',
  yearsRequired: 0,
  hardSkills: ['Node.js', 'PostgreSQL', 'RESTful API'],
  softSkills: ['làm việc nhóm'],
  responsibilities: ['Phát triển API', 'Viết unit test'],
  atsKeywords: ['Node.js', 'PostgreSQL', 'RESTful API', 'Git'],
  niceToHave: ['Docker'],
  education: 'Đại học chuyên ngành CNTT',
}
