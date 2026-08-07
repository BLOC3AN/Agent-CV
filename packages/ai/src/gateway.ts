import type { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { AppConfig, RouteConfig } from './config.js'
import { loadConfig, getRoute, limitsFor } from './config.js'
import { ProviderRegistry } from './providers/index.js'
import {
  BreakerRegistry,
  Semaphore,
  withTimeout,
  type BreakerOptions,
} from './policies.js'
import { CachingTokenCounter, fitBudget } from './budget.js'
import { detectPII } from './pii.js'
import {
  GatewayError,
  type CallMeta,
  type ChatProvider,
  type PromptSection,
  type RunOptions,
  type TaskDefinition,
  type TaskResult,
} from './types.js'

/**
 * Model Gateway — TDD §5.
 *
 * Điểm vào DUY NHẤT tới model. Code nghiệp vụ chỉ gọi `gateway.run(task, input)`
 * và KHÔNG BAO GIỜ biết đang chạy Qwen hay Claude (TDD A6).
 *
 * Vòng đời một lời gọi (TDD §5.3):
 *   1. resolveRoute        ← config.yml routing
 *   2. checkBreaker        ← mở? → fallback / trả degraded
 *   3. buildSections + fitBudget  ← §6, có thể nén/bỏ section droppable
 *   4. call provider       ← timeout theo policies
 *   5. validate(schema)    ← fail → retry → escalate|fail theo onSchemaFail
 *   6. log CallMeta        ← LUÔN LUÔN, kể cả khi lỗi
 */

export type CallLogger = (meta: CallMeta, error?: GatewayError) => void

export interface GatewayOptions {
  config?: AppConfig
  registry?: ProviderRegistry
  logger?: CallLogger
  /** Inject đồng hồ cho test breaker */
  now?: () => number
}

interface ResolvedRoute {
  primary: string
  fallback: string | null
  requiredLocal: boolean
  maxRetries: number
  onSchemaFail: TaskDefinition<unknown, unknown>['onSchemaFail']
}

export class Gateway {
  readonly config: AppConfig
  readonly registry: ProviderRegistry
  readonly breakers: BreakerRegistry
  private readonly logger: CallLogger
  private readonly counters = new Map<string, CachingTokenCounter>()
  private readonly semaphores = new Map<string, Semaphore>()
  /**
   * Cache theo CHÍNH ĐỐI TƯỢNG schema, KHÔNG theo tên task.
   * Nhiều task có thể dùng chung một tên để chia sẻ route trong config.yml
   * (7 task parse-section đều tên `parse_cv_to_profile`) — cache theo tên sẽ
   * ép các task đó sinh JSON theo hình dạng của task chạy trước.
   */
  private readonly jsonSchemas = new WeakMap<object, unknown>()

  constructor(opts: GatewayOptions = {}) {
    this.config = opts.config ?? loadConfig()
    this.registry = opts.registry ?? new ProviderRegistry(this.config)
    this.logger = opts.logger ?? (() => {})

    const cb = this.config.policies.circuit_breaker
    const breakerOpts: BreakerOptions = {
      failureThreshold: cb.failure_threshold,
      cooldownMs: cb.cooldown_seconds * 1_000,
      halfOpenProbes: cb.half_open_probes,
      ...(opts.now ? { now: opts.now } : {}),
    }
    this.breakers = new BreakerRegistry(breakerOpts)
  }

  // ── Bước 1: định tuyến ────────────────────────────────────────────────────

  /**
   * TDD §15.2 R2 + TC-SEC-03:
   * Task có `required_local: true` KHÔNG BAO GIỜ được fallback sang cloud —
   * fallback ở đây đồng nghĩa với việc gửi PII thô ra ngoài.
   */
  resolveRoute(taskName: string, force?: string): ResolvedRoute {
    const r: RouteConfig = getRoute(this.config, taskName)
    const primary = force ?? r.primary

    let fallback = r.fallback
    if (r.required_local && fallback && !fallback.startsWith('local.')) {
      throw new GatewayError(
        'PII_GUARD',
        `Task "${taskName}" có required_local: true nhưng fallback "${fallback}" ` +
          `không phải local. Cấu hình này làm rò rỉ PII — sửa config.yml.`,
      )
    }
    if (r.required_local) fallback = null

    return {
      primary,
      fallback,
      requiredLocal: r.required_local,
      maxRetries: r.max_retries ?? this.config.policies.defaults.retries,
      onSchemaFail:
        (r.on_schema_fail as ResolvedRoute['onSchemaFail']) ?? 'retry_then_escalate',
    }
  }

  // ── Hạ tầng phụ trợ ───────────────────────────────────────────────────────

  private counterFor(modelRef: string): CachingTokenCounter {
    let c = this.counters.get(modelRef)
    if (!c) {
      const provider = this.registry.chat(modelRef)
      c = new CachingTokenCounter((t) => provider.countTokens(t))
      this.counters.set(modelRef, c)
    }
    return c
  }

  /**
   * Zod → JSON Schema cho constrained decoding.
   * `$refStrategy: none` để nội tuyến hết — grammar builder của llama.cpp
   * xử lý $ref kém ổn định. Cache theo tên task.
   */
  private jsonSchemaFor(task: TaskDefinition<unknown, unknown>): unknown {
    const key = task.schema as unknown as object
    let s = this.jsonSchemas.get(key)
    if (!s) {
      s = zodToJsonSchema(task.schema as z.ZodTypeAny, {
        target: 'jsonSchema7',
        $refStrategy: 'none',
      })
      this.jsonSchemas.set(key, s)
    }
    return s
  }

  private semaphoreFor(modelRef: string): Semaphore {
    let s = this.semaphores.get(modelRef)
    if (!s) {
      const l = limitsFor(this.config, modelRef)
      s = new Semaphore(l.max_concurrency, l.queue_size)
      this.semaphores.set(modelRef, s)
    }
    return s
  }

  // ── Bước 3–5: chạy task ───────────────────────────────────────────────────

  async run<TInput, TOutput>(
    task: TaskDefinition<TInput, TOutput>,
    input: TInput,
    opts: RunOptions = {},
  ): Promise<TaskResult<TOutput>> {
    const started = Date.now()
    const route = this.resolveRoute(task.name, opts.forceModel)

    const meta: CallMeta = {
      task: task.name,
      provider: 'none',
      model: route.primary,
      latencyMs: 0,
      promptTokens: 0,
      completionTokens: 0,
      schemaValid: false,
      attempts: 0,
      escalated: false,
      truncated: false,
      droppedSections: [],
    }

    const chain: string[] = [route.primary]
    if (route.fallback) chain.push(route.fallback)

    let lastError: GatewayError | null = null

    for (const modelRef of chain) {
      const isEscalation = modelRef !== route.primary
      if (isEscalation) meta.escalated = true
      meta.model = modelRef

      // ── Bước 2: circuit breaker ────────────────────────────────────────
      const breaker = this.breakers.get(modelRef)
      if (!breaker.canPass()) {
        lastError = new GatewayError(
          'CIRCUIT_OPEN',
          `Circuit breaker của "${modelRef}" đang mở (${breaker.failureCount} lỗi liên tiếp)`,
        )
        continue
      }

      let provider: ChatProvider
      try {
        provider = this.registry.chat(modelRef)
      } catch (err) {
        lastError = err as GatewayError
        continue
      }

      try {
        const result = await this.attemptWithRetries(
          task,
          input,
          modelRef,
          provider,
          route,
          meta,
          opts,
        )
        breaker.onSuccess()
        meta.latencyMs = Date.now() - started
        meta.provider = provider.kind
        meta.schemaValid = true
        this.logger(meta)
        return { ok: true, data: result, meta }
      } catch (err) {
        const ge =
          err instanceof GatewayError
            ? err
            : new GatewayError('UNKNOWN', (err as Error).message, err)
        lastError = ge

        // Lỗi schema/ngân sách KHÔNG phải lỗi hạ tầng → không tính vào breaker
        if (
          ge.code !== 'SCHEMA_INVALID' &&
          ge.code !== 'BUDGET_EXCEEDED' &&
          ge.code !== 'BAD_INPUT' &&
          ge.code !== 'PII_GUARD'
        ) {
          breaker.onFailure()
        }

        // fail_fast / retry_then_fail → không escalate sang model khác
        if (ge.code === 'SCHEMA_INVALID' && route.onSchemaFail !== 'retry_then_escalate') {
          break
        }
        if (
          ge.code === 'BUDGET_EXCEEDED' ||
          ge.code === 'PII_GUARD' ||
          ge.code === 'BAD_INPUT'
        ) {
          break
        }
      }
    }

    meta.latencyMs = Date.now() - started
    const error =
      lastError ?? new GatewayError('UNKNOWN', `Task "${task.name}" thất bại không rõ lý do`)
    this.logger(meta, error)
    return { ok: false, error, meta }
  }

  private async attemptWithRetries<TInput, TOutput>(
    task: TaskDefinition<TInput, TOutput>,
    input: TInput,
    modelRef: string,
    provider: ChatProvider,
    route: ResolvedRoute,
    meta: CallMeta,
    opts: RunOptions,
  ): Promise<TOutput> {
    const maxAttempts = Math.max(1, route.maxRetries + 1)
    let lastSchemaError: GatewayError | null = null

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      meta.attempts++
      const breaker = this.breakers.get(modelRef)
      breaker.markAttempt()

      // ── Bước 3: dựng prompt + ép ngân sách ───────────────────────────
      // Bỏ section RỖNG trước mọi bước sau.
      //
      // `buildSections` hay dựng section theo điều kiện — không có đoạn tri
      // thức KB, chưa có câu trả lời làm rõ — và trả về chuỗi rỗng. Một section
      // rỗng không mang thông tin nào, nhưng vẫn thành một message trống gửi
      // tới model và làm guard placeholder báo động nhầm.
      const sections = (await task.buildSections(input)).filter((s) => s.content.trim() !== '')
      guardPlaceholders(sections, task.name)
      this.guardPII(sections, task.name)

      const fit = await fitBudget(sections, task.budget, this.counterFor(modelRef))
      meta.truncated = meta.truncated || fit.truncated
      meta.droppedSections = fit.droppedSections

      // ── Bước 4: gọi provider ─────────────────────────────────────────
      const limits = limitsFor(this.config, modelRef)
      const timeoutMs = task.timeoutMs ?? limits.timeout_ms
      const release = await this.semaphoreFor(modelRef).acquire()
      let raw: string
      try {
        const res = await withTimeout(
          (signal) =>
            provider.chat({
              messages: fit.messages,
              maxTokens: task.maxTokens ?? task.budget.reserveForOutput,
              temperature: task.temperature ?? 0,
              signal,
              ...(opts.onToken ? { onToken: opts.onToken } : {}),
              ...(task.constrainedOutput === false
                ? {}
                : {
                    jsonSchema: {
                      name: task.name,
                      schema: this.jsonSchemaFor(
                        task as unknown as TaskDefinition<unknown, unknown>,
                      ),
                    },
                  }),
            }),
          timeoutMs,
          opts.signal,
        )
        raw = res.text
        meta.promptTokens = res.promptTokens || fit.promptTokens
        meta.completionTokens = res.completionTokens
      } finally {
        release()
      }

      // ── Bước 5: validate schema ──────────────────────────────────────
      const parsed = this.validate(task.schema, raw)
      if (parsed.ok) return parsed.data

      lastSchemaError = new GatewayError(
        'SCHEMA_INVALID',
        `${modelRef} lần ${attempt}/${maxAttempts}: ${parsed.message}`,
      )
      if (route.onSchemaFail === 'fail_fast') break
    }

    throw lastSchemaError ?? new GatewayError('SCHEMA_INVALID', 'Schema không hợp lệ')
  }

  /**
   * TDD §15.2 R1 + TC-SEC-01 — chốt chặn cuối cùng.
   * Nếu PII lọt vào prompt thì NÉM LỖI, không gửi đi.
   */
  private guardPII(sections: PromptSection[], taskName: string): void {
    for (const s of sections) {
      const leaks = detectPII(s.content)
      if (leaks.length > 0) {
        throw new GatewayError(
          'PII_GUARD',
          `Task "${taskName}" section "${s.key}" chứa PII ` +
            `(${leaks.map((l) => l.kind).join(', ')}). Payload KHÔNG được gửi. ` +
            `Chạy stripPII() trước khi dựng prompt.`,
        )
      }
    }
  }

  /**
   * Model local trả JSON sai là chuyện BÌNH THƯỜNG (TDD A5).
   * Bóc JSON khoan dung: chấp nhận ```json fence và text thừa quanh object.
   */
  private validate<T>(
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    raw: string,
  ): { ok: true; data: T } | { ok: false; message: string } {
    const candidate = extractJson(raw)
    if (candidate === null) {
      return { ok: false, message: 'Không tìm thấy JSON trong output' }
    }
    let json: unknown
    try {
      json = JSON.parse(candidate)
    } catch (err) {
      return { ok: false, message: `JSON.parse lỗi: ${(err as Error).message}` }
    }
    const res = schema.safeParse(json)
    if (!res.success) {
      const issues = res.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')
      return { ok: false, message: `Schema: ${issues}` }
    }
    return { ok: true, data: res.data }
  }

  // ── Health cho UC-71 ──────────────────────────────────────────────────────

  async health(): Promise<{
    healthy: boolean
    models: Record<string, boolean>
    breakers: Record<string, string>
  }> {
    const models = await this.registry.healthAll()
    const values = Object.values(models)
    return {
      healthy: values.length > 0 && values.some(Boolean),
      models,
      breakers: this.breakers.snapshot(),
    }
  }
}

/** Bóc object JSON đầu tiên cân bằng ngoặc từ output của model */
/**
 * Chặn prompt chứa placeholder của JavaScript — "undefined", "null", "[object Object]".
 *
 * Vì sao cần: `buildSections` nội suy field của input vào chuỗi. Gõ sai tên
 * field (`text` thay vì `rawText`) cho ra chuỗi "Mô tả công việc:\n\nundefined".
 * Model nhận được một prompt vô nghĩa, và vì có constrained decoding, nó vẫn
 * trả về JSON HỢP LỆ nhưng rỗng hoặc lặp lại tên field:
 *
 *     { "title": "", "domain": "yearsRequired", "education": "undefined" }
 *
 * Task báo `ok: true`. Không có lỗi nào ở đâu cả. Kết quả rỗng đó chảy xuống
 * lớp chấm điểm và trở thành một điểm số trông có vẻ hợp lý.
 *
 * Đây là kiểu hỏng tệ nhất — im lặng và trông giống thành công.
 */
const PLACEHOLDER = /(?:^|\n\n|:\s)(undefined|null|\[object Object\]|NaN)\s*$/

export function guardPlaceholders(sections: PromptSection[], taskName: string): void {
  for (const s of sections) {
    const m = PLACEHOLDER.exec(s.content.trimEnd())
    if (m) {
      throw new GatewayError(
        'BAD_INPUT',
        `Task "${taskName}" section "${s.key}" kết thúc bằng "${m[1]}" — ` +
          'nhiều khả năng buildSections nội suy một field không tồn tại. ' +
          'Payload KHÔNG được gửi.',
      )
    }
    // Section rỗng đã bị lọc trước khi tới đây (xem `run`), nên còn sót lại
    // nghĩa là ai đó gọi thẳng hàm này — vẫn chặn cho chắc.
    if (s.role === 'user' && s.content.trim() === '') {
      throw new GatewayError('BAD_INPUT', `Task "${taskName}" section "${s.key}" rỗng.`)
    }
  }
}

export function extractJson(raw: string): string | null {
  const text = raw.trim()
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  const body = fence?.[1]?.trim() ?? text

  const start = body.search(/[[{]/)
  if (start === -1) return null

  const open = body[start]!
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inStr = false
  let esc = false

  for (let i = start; i < body.length; i++) {
    const ch = body[i]!
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return body.slice(start, i + 1)
    }
  }
  return null
}

/** Định nghĩa task — dùng ở packages/ai/src/tasks/<name>/index.ts */
export function defineTask<TInput, TOutput>(
  def: TaskDefinition<TInput, TOutput>,
): TaskDefinition<TInput, TOutput> {
  return def
}
