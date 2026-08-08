import { describe, it, expect, beforeAll } from 'vitest'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { loadConfig, modelBaseUrl } from '../src/config.js'
import { stripGrammarHostile } from '../src/gateway.js'
import { planAgentStepTask, insightMiningTask, proposePatchTask } from '../src/tasks/agent.js'
import { answerQuestionTask } from '../src/tasks/answer.js'
import { gapAnalysisTask } from '../src/tasks/gap-analysis.js'
import { parseJDTask } from '../src/tasks/parse-jd.js'
import { makeSectionTask } from '../src/tasks/parse-section.js'

/**
 * Constrained decoding phải THẬT SỰ có hiệu lực — cho MỌI task.
 *
 * ── Vì sao test này tồn tại ──
 * llama.cpp chuyển JSON Schema thành grammar GBNF. Gặp cấu trúc không dựng
 * được, nó ghi "failed to parse grammar" vào LOG SERVER rồi trả HTTP 200 và
 * sinh tự do. Phía gọi KHÔNG nhận được tín hiệu nào.
 *
 * Đã xảy ra thật: `JsonPointerSchema` làm hỏng grammar của ba task, và toàn bộ
 * trợ lý chat chạy không có ràng buộc suốt M4 mà mọi test vẫn xanh — model tình
 * cờ tuân theo prompt là đủ để qua.
 *
 * Test này bắt đúng khoảng mù đó: gửi prompt VÔ NGHĨA để model không có gợi ý
 * nào từ nội dung, rồi kiểm xem output có bị grammar ép về đúng hình dạng không.
 *
 *   npm run test:int
 */

const cfg = loadConfig()
let base = ''
let up = false

beforeAll(async () => {
  base = modelBaseUrl(cfg, 'reasoner')
  up = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5_000) }).then(
    (r) => r.ok,
    () => false,
  )
}, 30_000)

/**
 * Grammar có hiệu lực không.
 *
 * Prompt cố tình vô nghĩa: nếu grammar hoạt động, model BUỘC phải sinh đúng
 * khoá bắt buộc của schema. Nếu grammar bị bỏ, nó sẽ trả lời tự do và các khoá
 * đó không xuất hiện.
 */
async function grammarApplies(schema: unknown, requiredKeys: string[]): Promise<{
  ok: boolean
  firstKey: string
  raw: string
}> {
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'xin chào' }],
      max_tokens: 60,
      temperature: 0,
      response_format: { type: 'json_schema', json_schema: { name: 'o', schema, strict: true } },
    }),
    signal: AbortSignal.timeout(60_000),
  })
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const raw = (j.choices?.[0]?.message?.content ?? '').trim()
  const firstKey = /"([a-zA-Z_][a-zA-Z0-9_]*)"\s*:/.exec(raw)?.[1] ?? '(không có khoá)'
  return { ok: requiredKeys.includes(firstKey), firstKey, raw: raw.slice(0, 120) }
}

const TASKS = [
  ['plan_agent_step', planAgentStepTask, ['intent', 'targetPath', 'needsInfo']],
  ['insight_mining', insightMiningTask, ['reason', 'targetPath', 'questions']],
  ['propose_patch', proposePatchTask, ['ops', 'summary']],
  ['answer_question', answerQuestionTask, ['answer', 'nextSteps', 'kbRefs']],
  ['gap_analysis', gapAnalysisTask, ['advices', 'summary']],
  ['parse_jd', parseJDTask, ['title', 'language', 'roleFamily', 'seniority']],
  ['parse_cv_to_profile', makeSectionTask('work'), ['items']],
] as const

describe('constrained decoding có hiệu lực với MỌI task', () => {
  for (const [name, task, keys] of TASKS) {
    it(
      `${name}: grammar ép được hình dạng`,
      async () => {
        if (!up) {
          console.warn('⏭  model server không phản hồi')
          return
        }
        const schema = stripGrammarHostile(
          zodToJsonSchema(task.schema as z.ZodTypeAny, {
            target: 'jsonSchema7',
            $refStrategy: 'none',
          }),
        )
        const r = await grammarApplies(schema, keys as unknown as string[])
        console.log(`  ${r.ok ? '✓' : '✗'} ${name.padEnd(22)} khoá đầu "${r.firstKey}"`)

        expect(
          r.ok,
          `grammar bị BỎ QUA — model sinh tự do: ${r.raw}\n` +
            `Kiểm xem schema có cấu trúc nào llama.cpp không dựng grammar được không.`,
        ).toBe(true)
      },
      120_000,
    )
  }
})

describe('stripGrammarHostile', () => {
  it('bỏ `pattern` ở MỌI độ sâu', () => {
    const input = {
      type: 'object',
      properties: {
        a: { type: 'string', pattern: '^x$' },
        b: { type: 'array', items: { type: 'object', properties: { c: { pattern: '^y$' } } } },
      },
    }
    const out = JSON.stringify(stripGrammarHostile(input))
    expect(out).not.toContain('pattern')
    // Phần còn lại giữ nguyên
    expect(out).toContain('"type":"string"')
    expect(out).toContain('"items"')
  })

  it('không đụng tới giá trị nguyên thuỷ và mảng', () => {
    expect(stripGrammarHostile(['a', 1, null])).toEqual(['a', 1, null])
    expect(stripGrammarHostile('x')).toBe('x')
    expect(stripGrammarHostile(null)).toBeNull()
  })

  it('KHÔNG sửa schema gốc', () => {
    const input = { properties: { a: { pattern: '^x$' } } }
    stripGrammarHostile(input)
    expect(input.properties.a.pattern).toBe('^x$')
  })
})

describe('grammar BẮT BUỘC "value" cho op sinh nội dung', () => {
  /**
   * TC-53-31 ở tầng GRAMMAR.
   *
   * `z.unknown()` biến thành `{}` trong JSON Schema và không bao giờ vào
   * `required`. Grammar sinh ra từ đó tự nói với model rằng "value" là tuỳ
   * chọn — model 4B bỏ đi thật, và người dùng nhận `op "replace" thiếu
   * "value"` sau khi đã tick và bấm Áp dụng. Đo trên model thật: 2/2 op thiếu.
   */
  it('"value" nằm trong `required` của op', () => {
    const j = stripGrammarHostile(
      zodToJsonSchema(proposePatchTask.schema as z.ZodTypeAny, {
        target: 'jsonSchema7',
        $refStrategy: 'none',
      }),
    ) as {
      properties: { ops: { items: { required: string[]; properties: { value: object } } } }
    }
    const item = j.properties.ops.items
    expect(item.required).toContain('value')
    // `{}` rỗng nghĩa là "kiểu gì cũng được" — grammar không ép được gì cả
    expect(Object.keys(item.properties.value).length).toBeGreaterThan(0)
  })
})

describe('schema Zod vẫn giữ ràng buộc pattern', () => {
  it('`pattern` chỉ bị lược ở bản dùng làm GRAMMAR, không phải ở validate', () => {
    // Bỏ pattern khỏi grammar KHÔNG được làm yếu việc kiểm output.
    // `proposePatchTask.schema` vẫn từ chối đường dẫn sai định dạng.
    const bad = {
      ops: [
        {
          op: 'replace',
          path: 'không-phải-json-pointer',
          value: 'x',
          rationale: 'lý do đủ dài để qua min(10)',
          grounding: { type: 'inference', ref: 'x' },
          kbRefs: [],
        },
      ],
      summary: 'x',
    }
    expect(proposePatchTask.schema.safeParse(bad).success).toBe(false)
  })
})
