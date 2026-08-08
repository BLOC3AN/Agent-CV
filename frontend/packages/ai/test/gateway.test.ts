import { describe, it, expect, beforeEach } from 'vitest'
import { z } from 'zod'
import { Gateway, defineTask, extractJson } from '../src/gateway.js'
import { ProviderRegistry } from '../src/providers/index.js'
import { loadConfig, resetConfigCache } from '../src/config.js'
import { GatewayError, type CallMeta, type PromptSection } from '../src/types.js'
import { MockChatProvider, VALID_JD } from './mocks.js'
import { parseJDTask } from '../src/tasks/parse-jd.js'
import { JDRequirementsSchema } from '@hr/schema'

/**
 * Test gateway THẬT (routing · breaker · budget · validate),
 * chỉ mock ở tầng provider (TESTCASES §1.4).
 */

function makeClock(start = 0) {
  let t = start
  return { now: () => t, advance: (ms: number) => (t += ms) }
}

function makeGateway(providers: Record<string, MockChatProvider>, now?: () => number) {
  resetConfigCache()
  const cfg = loadConfig()
  const registry = new ProviderRegistry(cfg)
  for (const [ref, p] of Object.entries(providers)) registry.registerChat(ref, p)
  const logs: { meta: CallMeta; error?: GatewayError }[] = []
  const gw = new Gateway({
    config: cfg,
    registry,
    logger: (meta, error) => logs.push({ meta, ...(error ? { error } : {}) }),
    ...(now ? { now } : {}),
  })
  return { gw, logs, cfg }
}

const trivialTask = defineTask<{ text: string }, { value: string }>({
  name: 'parse_jd', // dùng lại route có sẵn trong config.yml
  schema: z.object({ value: z.string() }),
  budget: { total: 3_000, reserveForOutput: 500 },
  onSchemaFail: 'retry_then_escalate',
  maxRetries: 2,
  buildSections: (i): PromptSection[] => [
    { key: 'system', role: 'system', content: 'SYS', max: 600, droppable: false },
    { key: 'body', role: 'user', content: i.text, max: 1_500, droppable: false },
  ],
})

beforeEach(() => resetConfigCache())

// ── Định tuyến ──────────────────────────────────────────────────────────────

describe('resolveRoute — đọc từ config.yml', () => {
  it('lấy primary/fallback đúng như khai báo', () => {
    const { gw } = makeGateway({})
    const r = gw.resolveRoute('parse_jd')
    expect(r.primary).toBe('local.reasoner')
    expect(r.fallback).toBe('local.generalist')
  })

  it('task chưa khai báo thì ném lỗi rõ ràng', () => {
    const { gw } = makeGateway({})
    expect(() => gw.resolveRoute('task_khong_ton_tai')).toThrow(/chưa khai báo/)
  })
})

describe('TC-SEC-03 — required_local KHÔNG BAO GIỜ fallback cloud', () => {
  it('redact_pii có required_local: true và fallback = null', () => {
    const { gw, cfg } = makeGateway({})
    expect(cfg.routing['redact_pii']?.required_local).toBe(true)
    const r = gw.resolveRoute('redact_pii')
    expect(r.requiredLocal).toBe(true)
    expect(r.fallback).toBeNull()
  })

  it('embed_text cũng required_local', () => {
    const { gw } = makeGateway({})
    expect(gw.resolveRoute('embed_text').fallback).toBeNull()
  })

  it('ngay cả khi bật anthropic, required_local vẫn không escalate ra cloud', () => {
    resetConfigCache()
    const cfg = loadConfig()
    // Bật cloud như thể đã gọi vốn xong
    cfg.providers.anthropic.enabled = true
    const registry = new ProviderRegistry(cfg)
    const gw = new Gateway({ config: cfg, registry })

    const r = gw.resolveRoute('redact_pii')
    expect(r.fallback).toBeNull()
    expect(r.primary.startsWith('local.')).toBe(true)
  })

  it('cấu hình sai (required_local + fallback cloud) bị chặn ngay', () => {
    resetConfigCache()
    const cfg = loadConfig()
    cfg.routing['redact_pii'] = {
      primary: 'local.reasoner',
      fallback: 'anthropic.cheap', // ← cấu hình sai, cố tình
      required_local: true,
      enabled: true,
    }
    const gw = new Gateway({ config: cfg, registry: new ProviderRegistry(cfg) })
    expect(() => gw.resolveRoute('redact_pii')).toThrow(/rò rỉ PII/)
  })
})

// ── Vòng đời lời gọi ────────────────────────────────────────────────────────

describe('run() — đường thành công', () => {
  it('trả data đã validate + CallMeta đầy đủ', async () => {
    const p = new MockChatProvider('local.reasoner', {
      kind: 'ok',
      payload: { value: 'xin chào' },
    })
    const { gw, logs } = makeGateway({ 'local.reasoner': p })

    const res = await gw.run(trivialTask, { text: 'nội dung' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.value).toBe('xin chào')
    expect(res.meta.model).toBe('local.reasoner')
    expect(res.meta.schemaValid).toBe(true)
    expect(res.meta.attempts).toBe(1)
    expect(res.meta.escalated).toBe(false)
    expect(logs).toHaveLength(1) // TDD §5.3 bước 6: LUÔN log
  })
})

describe('Schema fail → retry → escalate (TDD §5.3 bước 5)', () => {
  it('retry trên cùng model trước khi escalate', async () => {
    const primary = new MockChatProvider('local.reasoner', {
      kind: 'sequence',
      steps: [{ kind: 'schemaFail' }, { kind: 'ok', payload: { value: 'ok lần 2' } }],
    })
    const { gw } = makeGateway({ 'local.reasoner': primary })

    const res = await gw.run(trivialTask, { text: 'x' })
    expect(res.ok).toBe(true)
    expect(res.meta.attempts).toBe(2)
    expect(res.meta.escalated).toBe(false)
  })

  it('hết retry thì escalate sang fallback', async () => {
    const primary = new MockChatProvider('local.reasoner', { kind: 'schemaFail' })
    const fallback = new MockChatProvider('local.generalist', {
      kind: 'ok',
      payload: { value: 'fallback cứu' },
    })
    const { gw } = makeGateway({
      'local.reasoner': primary,
      'local.generalist': fallback,
    })

    const res = await gw.run(trivialTask, { text: 'x' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.value).toBe('fallback cứu')
    expect(res.meta.escalated).toBe(true)
    expect(res.meta.model).toBe('local.generalist')
    expect(primary.calls).toHaveLength(3) // 1 + 2 retry
  })

  it('output không phải JSON cũng tính là schema fail', async () => {
    const p = new MockChatProvider('local.reasoner', { kind: 'invalidJson' })
    const f = new MockChatProvider('local.generalist', { kind: 'invalidJson' })
    const { gw } = makeGateway({ 'local.reasoner': p, 'local.generalist': f })

    const res = await gw.run(trivialTask, { text: 'x' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error.code).toBe('SCHEMA_INVALID')
  })
})

describe('TC-DEG-01/03 — model chết', () => {
  it('primary chết thì dùng fallback', async () => {
    const primary = new MockChatProvider('local.reasoner', { kind: 'down' })
    const fallback = new MockChatProvider('local.generalist', {
      kind: 'ok',
      payload: { value: 'từ generalist' },
    })
    const { gw } = makeGateway({
      'local.reasoner': primary,
      'local.generalist': fallback,
    })

    const res = await gw.run(trivialTask, { text: 'x' })
    expect(res.ok).toBe(true)
    expect(res.meta.escalated).toBe(true)
  })

  it('cả hai chết → trả ok:false, KHÔNG ném exception (app không sập)', async () => {
    const { gw, logs } = makeGateway({
      'local.reasoner': new MockChatProvider('local.reasoner', { kind: 'down' }),
      'local.generalist': new MockChatProvider('local.generalist', { kind: 'down' }),
    })

    const res = await gw.run(trivialTask, { text: 'x' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toBeInstanceOf(GatewayError)
    expect(logs[0]?.error).toBeDefined()
  })

  it('sau 5 lần chết, breaker mở và KHÔNG chạm mạng nữa', async () => {
    const c = makeClock()
    const primary = new MockChatProvider('local.reasoner', { kind: 'down' })
    const fallback = new MockChatProvider('local.generalist', { kind: 'down' })
    const { gw } = makeGateway(
      { 'local.reasoner': primary, 'local.generalist': fallback },
      c.now,
    )

    for (let i = 0; i < 5; i++) await gw.run(trivialTask, { text: 'x' })
    const callsBefore = primary.calls.length

    const res = await gw.run(trivialTask, { text: 'x' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error.code).toBe('CIRCUIT_OPEN')
    expect(primary.calls.length).toBe(callsBefore) // không gọi thêm

    // TC-DEG-04: sau cooldown thì thử lại
    c.advance(60_000)
    primary.setBehavior({ kind: 'ok', payload: { value: 'hồi phục' } })
    const res2 = await gw.run(trivialTask, { text: 'x' })
    expect(res2.ok).toBe(true)
  })

  it('lỗi schema KHÔNG tính vào breaker (không phải lỗi hạ tầng)', async () => {
    const c = makeClock()
    const p = new MockChatProvider('local.reasoner', { kind: 'schemaFail' })
    const f = new MockChatProvider('local.generalist', { kind: 'schemaFail' })
    const { gw } = makeGateway({ 'local.reasoner': p, 'local.generalist': f }, c.now)

    for (let i = 0; i < 5; i++) await gw.run(trivialTask, { text: 'x' })
    expect(gw.breakers.get('local.reasoner').getState()).toBe('closed')
  })
})

describe('TC-SEC-01 — PII guard chặn trước khi gửi', () => {
  const piiTask = defineTask<{ text: string }, { value: string }>({
    name: 'parse_jd',
    schema: z.object({ value: z.string() }),
    budget: { total: 3_000, reserveForOutput: 500 },
    onSchemaFail: 'fail_fast',
    maxRetries: 0,
    buildSections: (i): PromptSection[] => [
      { key: 'body', role: 'user', content: i.text, max: 2_000, droppable: false },
    ],
  })

  it('SĐT lọt vào prompt → chặn, KHÔNG gọi provider', async () => {
    const p = new MockChatProvider('local.reasoner', {
      kind: 'ok',
      payload: { value: 'x' },
    })
    const { gw } = makeGateway({ 'local.reasoner': p })

    const res = await gw.run(piiTask, { text: 'Liên hệ: 0912345678 để trao đổi' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error.code).toBe('PII_GUARD')
    expect(p.calls).toHaveLength(0) // payload KHÔNG được gửi
  })

  it('email lọt vào prompt → chặn', async () => {
    const p = new MockChatProvider('local.reasoner', {
      kind: 'ok',
      payload: { value: 'x' },
    })
    const { gw } = makeGateway({ 'local.reasoner': p })
    const res = await gw.run(piiTask, { text: 'Gửi về nguyenvana@gmail.com nhé' })
    expect(res.ok).toBe(false)
    expect(p.calls).toHaveLength(0)
  })

  it('nội dung sạch thì đi qua bình thường', async () => {
    const p = new MockChatProvider('local.reasoner', {
      kind: 'ok',
      payload: { value: 'ok' },
    })
    const { gw } = makeGateway({ 'local.reasoner': p })
    const res = await gw.run(piiTask, { text: 'Xây dựng API bằng Node.js và PostgreSQL' })
    expect(res.ok).toBe(true)
    expect(p.calls).toHaveLength(1)
  })
})

// ── Bóc JSON ────────────────────────────────────────────────────────────────

describe('Constrained decoding — mặc định BẬT (TDD §1.1)', () => {
  it('gateway truyền jsonSchema xuống provider', async () => {
    const p = new MockChatProvider('local.reasoner', {
      kind: 'ok',
      payload: { value: 'x' },
    })
    const { gw } = makeGateway({ 'local.reasoner': p })
    await gw.run(trivialTask, { text: 'x' })

    const sent = p.calls[0]!.jsonSchema
    expect(sent).toBeDefined()
    expect(sent!.name).toBe('parse_jd')
    const schema = sent!.schema as { type?: string; properties?: Record<string, unknown> }
    expect(schema.type).toBe('object')
    expect(schema.properties).toHaveProperty('value')
  })

  it('schema nội tuyến, không dùng $ref (grammar builder xử lý $ref kém)', async () => {
    const p = new MockChatProvider('local.reasoner', { kind: 'ok', payload: VALID_JD })
    const { gw } = makeGateway({ 'local.reasoner': p })
    await gw.run(parseJDTask, { rawText: 'JD', language: 'vi' })

    const serialized = JSON.stringify(p.calls[0]!.jsonSchema!.schema)
    expect(serialized).not.toContain('$ref')
    expect(serialized).toContain('roleFamily')
  })

  it('HỒI QUY: hai task CÙNG TÊN nhưng khác schema không được dùng chung cache', async () => {
    // Bug đã gặp: cache JSON Schema theo task.name khiến 7 task parse-section
    // (đều tên `parse_cv_to_profile` để chia sẻ route) bị ép sinh JSON theo hình
    // dạng của task chạy TRƯỚC → 4/5 mục fail SCHEMA_INVALID.
    const taskA = defineTask<{ t: string }, { alpha: string }>({
      name: 'parse_jd',
      schema: z.object({ alpha: z.string() }),
      budget: { total: 3_000, reserveForOutput: 500 },
      onSchemaFail: 'fail_fast',
      maxRetries: 0,
      buildSections: (i): PromptSection[] => [
        { key: 'b', role: 'user', content: i.t, max: 900, droppable: false },
      ],
    })
    const taskB = defineTask<{ t: string }, { beta: number }>({
      name: 'parse_jd', // CÙNG TÊN, KHÁC SCHEMA
      schema: z.object({ beta: z.number() }),
      budget: { total: 3_000, reserveForOutput: 500 },
      onSchemaFail: 'fail_fast',
      maxRetries: 0,
      buildSections: (i): PromptSection[] => [
        { key: 'b', role: 'user', content: i.t, max: 900, droppable: false },
      ],
    })

    const p = new MockChatProvider('local.reasoner', {
      kind: 'sequence',
      steps: [
        { kind: 'ok', payload: { alpha: 'x' } },
        { kind: 'ok', payload: { beta: 7 } },
      ],
    })
    const { gw } = makeGateway({ 'local.reasoner': p })

    await gw.run(taskA, { t: 'x' })
    await gw.run(taskB, { t: 'x' })

    const sA = JSON.stringify(p.calls[0]!.jsonSchema!.schema)
    const sB = JSON.stringify(p.calls[1]!.jsonSchema!.schema)
    expect(sA).toContain('alpha')
    expect(sB).toContain('beta')
    expect(sB).not.toContain('alpha') // ← nếu fail: cache đang key theo tên
  })

  it('constrainedOutput: false thì KHÔNG truyền jsonSchema', async () => {
    const freeform = defineTask<{ text: string }, { value: string }>({
      name: 'parse_jd',
      schema: z.object({ value: z.string() }),
      budget: { total: 3_000, reserveForOutput: 500 },
      onSchemaFail: 'fail_fast',
      maxRetries: 0,
      constrainedOutput: false,
      buildSections: (i): PromptSection[] => [
        { key: 'body', role: 'user', content: i.text, max: 2_000, droppable: false },
      ],
    })
    const p = new MockChatProvider('local.reasoner', {
      kind: 'ok',
      payload: { value: 'x' },
    })
    const { gw } = makeGateway({ 'local.reasoner': p })
    await gw.run(freeform, { text: 'x' })
    expect(p.calls[0]!.jsonSchema).toBeUndefined()
  })
})

describe('HỒI QUY: timeout theo task, không phải theo connect timeout', () => {
  it('task.timeoutMs ghi đè timeout của model', async () => {
    // Bug đã gặp: connect_timeout_ms (3s) bị áp làm timeout TOÀN CUỘC GỌI, nên
    // mọi task sinh dài (~100s ở 35 tok/s) đều chết trước khi model kịp trả lời.
    const slowTask = defineTask<{ t: string }, { value: string }>({
      name: 'parse_jd',
      schema: z.object({ value: z.string() }),
      budget: { total: 3_000, reserveForOutput: 500 },
      onSchemaFail: 'fail_fast',
      maxRetries: 0,
      timeoutMs: 5_000, // dài hơn thời gian mock trả lời
      buildSections: (i): PromptSection[] => [
        { key: 'b', role: 'user', content: i.t, max: 900, droppable: false },
      ],
    })
    const p = new MockChatProvider('local.reasoner', {
      kind: 'slow',
      ms: 1_200,
      payload: { value: 'kịp' },
    })
    const { gw } = makeGateway({ 'local.reasoner': p })
    const res = await gw.run(slowTask, { t: 'x' })
    expect(res.ok).toBe(true)
  })

  it('vượt task.timeoutMs thì vẫn abort đúng hạn', async () => {
    const strictTask = defineTask<{ t: string }, { value: string }>({
      name: 'parse_jd',
      schema: z.object({ value: z.string() }),
      budget: { total: 3_000, reserveForOutput: 500 },
      onSchemaFail: 'fail_fast',
      maxRetries: 0,
      timeoutMs: 300,
      buildSections: (i): PromptSection[] => [
        { key: 'b', role: 'user', content: i.t, max: 900, droppable: false },
      ],
    })
    const p = new MockChatProvider('local.reasoner', {
      kind: 'slow',
      ms: 3_000,
      payload: { value: 'quá muộn' },
    })
    const f = new MockChatProvider('local.generalist', { kind: 'down' })
    const { gw } = makeGateway({ 'local.reasoner': p, 'local.generalist': f })
    const res = await gw.run(strictTask, { t: 'x' })
    expect(res.ok).toBe(false)
  })
})

describe('extractJson — model 4B trả JSON bẩn là chuyện bình thường', () => {
  it('JSON thuần', () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}')
  })
  it('bọc trong ```json fence', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}')
  })
  it('có text thừa hai đầu', () => {
    expect(extractJson('Đây là kết quả:\n{"a":1}\nHy vọng giúp ích!')).toBe('{"a":1}')
  })
  it('ngoặc lồng nhau', () => {
    expect(extractJson('{"a":{"b":[1,2]},"c":"}"}')).toBe('{"a":{"b":[1,2]},"c":"}"}')
  })
  it('chuỗi có escape', () => {
    expect(extractJson('{"a":"x\\"y}"}')).toBe('{"a":"x\\"y}"}')
  })
  it('không có JSON thì trả null', () => {
    expect(extractJson('Xin chào, tôi không hiểu yêu cầu')).toBeNull()
  })
})

// ── Task parse_jd thật ──────────────────────────────────────────────────────

describe('parse_jd — task thật với mock provider', () => {
  it('parse JD tiếng Việt hợp lệ', async () => {
    const p = new MockChatProvider('local.reasoner', { kind: 'ok', payload: VALID_JD })
    const { gw } = makeGateway({ 'local.reasoner': p })

    const res = await gw.run(parseJDTask, {
      rawText: 'Tuyển Backend Developer fresher. Yêu cầu Node.js, PostgreSQL.',
      language: 'vi',
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.roleFamily).toBe('backend_developer')
    expect(res.data.seniority).toBe('fresher')
    expect(res.data.hardSkills).toContain('Node.js')
  })

  it('payload mẫu khớp JDRequirementsSchema', () => {
    expect(JDRequirementsSchema.safeParse(VALID_JD).success).toBe(true)
  })

  it('BR-41.1 — JD dài bị cắt phần phúc lợi, giữ phần yêu cầu', async () => {
    const requirements = 'YÊU CẦU CÔNG VIỆC\nThành thạo Node.js và PostgreSQL.\n\n'
    const benefits = 'QUYỀN LỢI\nLương thưởng hấp dẫn, du lịch hàng năm.\n\n'.repeat(200)
    const p = new MockChatProvider('local.reasoner', { kind: 'ok', payload: VALID_JD })
    const { gw } = makeGateway({ 'local.reasoner': p })

    const res = await gw.run(parseJDTask, {
      rawText: requirements + benefits,
      language: 'vi',
    })
    expect(res.ok).toBe(true)
    const sent = p.calls[0]!.messages.map((m) => m.content).join('\n')
    expect(sent).toContain('Node.js')
    expect(res.meta.truncated).toBe(true)
  })

  it('prompt tiếng Việt và tiếng Anh khác nhau (TDD §9.3)', async () => {
    const p = new MockChatProvider('local.reasoner', { kind: 'ok', payload: VALID_JD })
    const { gw } = makeGateway({ 'local.reasoner': p })

    await gw.run(parseJDTask, { rawText: 'A', language: 'vi' })
    await gw.run(parseJDTask, { rawText: 'A', language: 'en' })
    expect(p.calls[0]!.messages[0]!.content).not.toBe(p.calls[1]!.messages[0]!.content)
    expect(p.calls[1]!.messages[0]!.content).toContain('Return JSON only')
  })
})

// ── Ghi đè host bằng biến môi trường ────────────────────────────────────────

describe('MODEL_HOST ghi đè base_url trong config.yml', () => {
  it('không đặt biến → dùng base_url của config', () => {
    delete process.env.MODEL_HOST
    resetConfigCache()
    expect(loadConfig().providers.local.base_url).toBe('http://100.68.50.41')
  })

  it('đặt biến → ghi đè, KHÔNG phải sửa config.yml đã commit', () => {
    process.env.MODEL_HOST = 'http://127.0.0.1:9'
    resetConfigCache()
    expect(loadConfig().providers.local.base_url).toBe('http://127.0.0.1:9')
    delete process.env.MODEL_HOST
    resetConfigCache()
  })

  it('bỏ dấu / thừa ở cuối để URL ghép không thành //', () => {
    process.env.MODEL_HOST = 'http://example.test:8080/'
    resetConfigCache()
    expect(loadConfig().providers.local.base_url).toBe('http://example.test:8080')
    delete process.env.MODEL_HOST
    resetConfigCache()
  })
})
