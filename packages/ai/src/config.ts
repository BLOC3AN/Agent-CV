import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'

/**
 * Đọc config.yml — nguồn sự thật duy nhất về model & routing (TDD §5.2).
 * Đổi tuyến model = sửa YAML, KHÔNG sửa code nghiệp vụ.
 */

const LocalModelSchema = z
  .object({
    port: z.number().int(),
    model_id: z.string().optional(),
    api_style: z.enum(['openai', 'custom']).default('openai'),
    ctx_size_runtime: z.number().int().optional(),
    multimodal: z.boolean().optional(),
    dimensions: z.number().int().optional(),
    endpoint: z.string().optional(),
    role: z.string().optional(),
  })
  .passthrough()

const RouteSchema = z
  .object({
    primary: z.string(),
    fallback: z.string().nullable().default(null),
    required_local: z.boolean().default(false),
    schema: z.string().optional(),
    on_schema_fail: z.string().optional(),
    max_retries: z.number().int().optional(),
    when_funded: z.string().optional(),
  })
  .passthrough()

const LimitSchema = z
  .object({
    max_concurrency: z.number().int().default(2),
    queue_size: z.number().int().default(20),
    timeout_ms: z.number().int().default(30_000),
    batch_size: z.number().int().optional(),
  })
  .passthrough()

const ConfigSchema = z
  .object({
    meta: z
      .object({
        version: z.number().int(),
        cost_mode: z.enum(['local_only', 'hybrid', 'cloud_preferred']),
      })
      .passthrough(),

    infrastructure: z.unknown().optional(),

    providers: z.object({
      local: z
        .object({
          enabled: z.boolean(),
          base_url: z.string(),
          models: z.record(LocalModelSchema),
        })
        .passthrough(),
      anthropic: z
        .object({
          enabled: z.boolean(),
          api_key_env: z.string().default('ANTHROPIC_API_KEY'),
          models: z.record(z.object({ model_id: z.string() }).passthrough()),
        })
        .passthrough(),
    }),

    routing: z.record(RouteSchema),

    policies: z
      .object({
        defaults: z
          .object({
            timeout_ms: z.number().int().default(30_000),
            connect_timeout_ms: z.number().int().default(3_000),
            retries: z.number().int().default(2),
          })
          .passthrough(),
        per_model_limits: z.record(LimitSchema).default({}),
        circuit_breaker: z
          .object({
            failure_threshold: z.number().int().default(5),
            cooldown_seconds: z.number().int().default(60),
            half_open_probes: z.number().int().default(1),
          })
          .passthrough(),
        health_check: z
          .object({
            interval_seconds: z.number().int().default(30),
            unhealthy_after_failures: z.number().int().default(3),
          })
          .passthrough(),
        schema_validation: z
          .object({
            enabled: z.boolean().default(true),
            escalate_rate_alert_threshold: z.number().default(0.15),
          })
          .passthrough()
          .optional(),
      })
      .passthrough(),

    knowledge_base: z
      .object({
        strategy: z.enum(['context_injection', 'hybrid_retrieval']),
        auto_switch_threshold_tokens: z.number().int().default(8_000),
      })
      .passthrough(),
  })
  .passthrough()

export type AppConfig = z.infer<typeof ConfigSchema>
export type RouteConfig = z.infer<typeof RouteSchema>
export type LocalModelConfig = z.infer<typeof LocalModelSchema>

function repoRoot(): string {
  // packages/ai/src/config.ts → ../../..
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
}

let cached: AppConfig | null = null

export function loadConfig(path?: string): AppConfig {
  if (cached && !path) return cached
  const file = path ?? process.env.HR_CONFIG_PATH ?? resolve(repoRoot(), 'config.yml')
  const raw = parseYaml(readFileSync(file, 'utf8')) as Record<string, unknown>

  /*
   * MODEL_HOST ghi đè `providers.local.base_url`.
   *
   * Cần thiết để trỏ sang host khác (staging, mock cục bộ, hoặc cổng chết khi
   * kiểm thử degrade) mà KHÔNG phải sửa config.yml đã commit.
   *
   * Trước đây .env.example và docker-compose.yml đều khai biến này nhưng code
   * không đọc — cấu hình chết, và làm test degrade cho kết quả sai (tưởng model
   * server đã chết nhưng thực ra vẫn gọi vào host thật).
   */
  const hostOverride = process.env.MODEL_HOST?.trim()
  if (hostOverride) {
    const providers = raw['providers'] as Record<string, Record<string, unknown>> | undefined
    if (providers?.['local']) {
      providers['local']['base_url'] = hostOverride.replace(/\/$/, '')
    }
  }

  const parsed = ConfigSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(
      `config.yml không hợp lệ:\n${parsed.error.issues
        .map((i) => `  · ${i.path.join('.')}: ${i.message}`)
        .join('\n')}`,
    )
  }
  if (!path) cached = parsed.data
  return parsed.data
}

/** Chỉ dùng trong test */
export function resetConfigCache(): void {
  cached = null
}

/** "local.reasoner" → { provider: "local", alias: "reasoner" } */
export function parseModelRef(ref: string): { provider: string; alias: string } {
  const idx = ref.indexOf('.')
  if (idx === -1) return { provider: ref, alias: '' }
  return { provider: ref.slice(0, idx), alias: ref.slice(idx + 1) }
}

export function getRoute(cfg: AppConfig, task: string): RouteConfig {
  const route = cfg.routing[task]
  if (!route) throw new Error(`Task "${task}" chưa khai báo trong config.yml → routing`)
  return route
}

export function getLocalModel(cfg: AppConfig, alias: string): LocalModelConfig {
  const m = cfg.providers.local.models[alias]
  if (!m) throw new Error(`Model local "${alias}" chưa khai báo trong config.yml`)
  return m
}

export function modelBaseUrl(cfg: AppConfig, alias: string): string {
  const m = getLocalModel(cfg, alias)
  return `${cfg.providers.local.base_url}:${m.port}`
}

export function limitsFor(cfg: AppConfig, modelRef: string): z.infer<typeof LimitSchema> {
  const l = cfg.policies.per_model_limits[modelRef]
  return (
    l ?? {
      max_concurrency: 2,
      queue_size: 20,
      timeout_ms: cfg.policies.defaults.timeout_ms,
    }
  )
}
