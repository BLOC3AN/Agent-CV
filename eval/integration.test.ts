import { describe, it, expect, beforeAll } from 'vitest'
import { loadConfig, modelBaseUrl } from '@hr/ai'
import {
  Gateway,
  ProviderRegistry,
  LlamaCppProvider,
  BgeEmbedProvider,
  BgeRerankProvider,
  parseJDTask,
  VI_EN_TOKEN_RATIO,
} from '@hr/ai'

/**
 * TC-INT-01..05 — kiểm thử tích hợp CHẠM SERVER THẬT.
 *
 * Mục đích: phát hiện thay đổi phía server. Server 100.68.50.41 nằm ngoài tầm
 * kiểm soát (TDD §2.1); nếu ai đó restart và cấu hình đổi, các test này phải
 * báo trong 15 phút thay vì để user gặp lỗi.
 *
 * Chạy: npm run test:int   (KHÔNG nằm trong `npm test` mặc định)
 */

const cfg = loadConfig()
const CHAT_ALIASES = ['reasoner', 'generalist', 'ocr', 'classifier'] as const

let reachable = false

beforeAll(async () => {
  try {
    const res = await fetch(`${modelBaseUrl(cfg, 'reasoner')}/v1/models`, {
      signal: AbortSignal.timeout(5_000),
    })
    reachable = res.ok
  } catch {
    reachable = false
  }
  if (!reachable) {
    console.warn(
      '\n⚠️  Không tới được model server (Tailscale?). Integration test sẽ FAIL — ' +
        'đây là hành vi đúng: TC-INT-01 tồn tại để phát hiện đúng tình huống này.\n',
    )
  }
})

// ── TC-INT-01 ───────────────────────────────────────────────────────────────

describe('TC-INT-01 — mọi endpoint còn sống', () => {
  for (const alias of CHAT_ALIASES) {
    it(`local.${alias} (:${cfg.providers.local.models[alias]?.port}) phản hồi /v1/models`, async () => {
      const res = await fetch(`${modelBaseUrl(cfg, alias)}/v1/models`, {
        signal: AbortSignal.timeout(10_000),
      })
      expect(res.ok).toBe(true)
    })
  }

  it('local.embedder (:8003) phản hồi /health', async () => {
    const res = await fetch(`${modelBaseUrl(cfg, 'embedder')}/health`, {
      signal: AbortSignal.timeout(10_000),
    })
    expect(res.ok).toBe(true)
  })

  it('local.reranker (:5014) phản hồi /v1/models', async () => {
    const res = await fetch(`${modelBaseUrl(cfg, 'reranker')}/v1/models`, {
      signal: AbortSignal.timeout(10_000),
    })
    expect(res.ok).toBe(true)
  })

  it('Gateway.health() báo cụm khoẻ', async () => {
    const gw = new Gateway({ config: cfg })
    const h = await gw.health()
    expect(h.healthy).toBe(true)
    expect(h.models['local.reasoner']).toBe(true)
  })
})

// ── TC-INT-02 ───────────────────────────────────────────────────────────────

describe('TC-INT-02 — model ID chưa đổi', () => {
  it.each(CHAT_ALIASES)('%s khớp model_id trong config.yml', async (alias) => {
    const expected = cfg.providers.local.models[alias]?.model_id
    expect(expected, `config.yml thiếu model_id cho ${alias}`).toBeTruthy()

    const res = await fetch(`${modelBaseUrl(cfg, alias)}/v1/models`, {
      signal: AbortSignal.timeout(10_000),
    })
    const json = (await res.json()) as { data?: { id?: string }[] }
    const actual = json.data?.[0]?.id ?? ''

    // So khớp lỏng: đủ để bắt việc thay model, không vỡ vì hậu tố quant
    const key = expected!.replace(/\.gguf$/, '').split('/').pop()!
    expect(
      actual.includes(key) || key.includes(actual.replace(/\.gguf$/, '')),
      `Server đang chạy "${actual}" nhưng config.yml khai "${expected}". ` +
        `Model đổi → prompt cần chỉnh lại.`,
    ).toBe(true)
  })
})

// ── TC-INT-03 (P0 — chí mạng) ───────────────────────────────────────────────

describe('TC-INT-03 — context window chưa đổi', () => {
  it('reasoner vẫn n_ctx = 16384', async () => {
    const p = new LlamaCppProvider('local.reasoner', {
      baseUrl: modelBaseUrl(cfg, 'reasoner'),
    })
    const props = await p.props()
    expect(
      props.nCtx,
      `n_ctx đổi từ 16384 → ${props.nCtx}. TOÀN BỘ ngân sách token trong ` +
        `TDD §6 sai, mọi task sẽ tràn context. Phải cập nhật config.yml + budget.ts NGAY.`,
    ).toBe(16_384)
  })

  it('reasoner vẫn 4 slot', async () => {
    const p = new LlamaCppProvider('local.reasoner', {
      baseUrl: modelBaseUrl(cfg, 'reasoner'),
    })
    const props = await p.props()
    expect(props.totalSlots).toBe(4)
  })

  it('nhận được prompt ~12.000 token (ngân sách làm việc)', async () => {
    const p = new LlamaCppProvider('local.reasoner', {
      baseUrl: modelBaseUrl(cfg, 'reasoner'),
    })
    const unit = 'Ứng viên xây dựng hệ thống quản lý kho bằng ReactJS và NodeJS. '
    const text = unit.repeat(700)
    const n = await p.countTokens(text)
    expect(n).toBeGreaterThan(9_000)

    const res = await p.chat({
      messages: [{ role: 'user', content: `${text}\n\nTrả lời đúng một từ: OK` }],
      maxTokens: 8,
      temperature: 0,
    })
    expect(res.promptTokens).toBeGreaterThan(9_000)
    expect(res.text.length).toBeGreaterThan(0)
  })
})

// ── TC-INT-04 ───────────────────────────────────────────────────────────────

describe('TC-INT-04 — embedder trả đúng 1024 chiều', () => {
  const embedder = () =>
    new BgeEmbedProvider({ baseUrl: modelBaseUrl(cfg, 'embedder') })

  it('model-info khớp bge-m3, dimension 1024, hybrid sẵn sàng', async () => {
    const info = await embedder().modelInfo()
    expect(info.name).toContain('bge-m3')
    expect(
      info.dimension,
      'Chiều vector đổi → index pgvector hỏng, phải re-embed toàn bộ',
    ).toBe(1024)
    expect(info.hybridReady).toBe(true)
  })

  it('POST /embed với field "text" (SỐ ÍT) trả vector 1024', async () => {
    const v = await embedder().embed('Xây dựng SPA bằng ReactJS')
    expect(v).toHaveLength(1024)
    expect(v.every((x) => typeof x === 'number' && Number.isFinite(x))).toBe(true)
  })

  it('embed đa ngôn ngữ: VI và EN cùng nghĩa gần nhau hơn VI và nội dung lạ', async () => {
    // Nền tảng cho TC-42-08 (CV tiếng Việt × JD tiếng Anh)
    const e = embedder()
    const vi = await e.embed('Xây dựng ứng dụng một trang bằng ReactJS')
    const en = await e.embed('Built single-page applications with React')
    const other = await e.embed('Công thức nấu phở bò truyền thống')

    const cos = (a: number[], b: number[]) => {
      let dot = 0
      let na = 0
      let nb = 0
      for (let i = 0; i < a.length; i++) {
        dot += a[i]! * b[i]!
        na += a[i]! ** 2
        nb += b[i]! ** 2
      }
      return dot / (Math.sqrt(na) * Math.sqrt(nb))
    }

    const same = cos(vi, en)
    const diff = cos(vi, other)
    expect(
      same,
      `Tương đồng VI↔EN (${same.toFixed(3)}) phải cao hơn VI↔nội dung lạ (${diff.toFixed(3)})`,
    ).toBeGreaterThan(diff)
  })
})

// ── TC-INT-05 ───────────────────────────────────────────────────────────────

describe('TC-INT-05 — reranker sắp xếp đúng', () => {
  it('tài liệu liên quan xếp trên tài liệu không liên quan', async () => {
    const r = new BgeRerankProvider({ baseUrl: modelBaseUrl(cfg, 'reranker') })
    const out = await r.rerank('React developer', [
      'Xây dựng SPA bằng ReactJS và Redux',
      'Nấu ăn và làm bánh',
    ])
    expect(out[0]?.index).toBe(0)
    expect(out[0]!.score).toBeGreaterThan(out[1]!.score)
  })

  it('score là logit — có thể âm, chỉ so sánh tương đối', async () => {
    const r = new BgeRerankProvider({ baseUrl: modelBaseUrl(cfg, 'reranker') })
    const out = await r.rerank('React developer', ['Nấu ăn'])
    expect(typeof out[0]?.score).toBe('number')
    // Không assert > 0: đo thực tế cho -5.26 và -7.36
  })
})

// ── TC-INT-06 — constrained decoding ────────────────────────────────────────

describe('TC-INT-06 — server hỗ trợ constrained decoding (json_schema)', () => {
  it('reasoner chấp nhận response_format json_schema và tuân thủ schema', async () => {
    const res = await fetch(`${modelBaseUrl(cfg, 'reasoner')}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        messages: [
          { role: 'user', content: 'Tuyển Backend Fresher, cần Node.js. Trích xuất.' },
        ],
        max_tokens: 200,
        temperature: 0,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'probe',
            schema: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                skills: { type: 'array', items: { type: 'string' } },
              },
              required: ['title', 'skills'],
              additionalProperties: false,
            },
          },
        },
      }),
    })
    expect(res.ok).toBe(true)
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const content = json.choices?.[0]?.message?.content ?? ''

    // Grammar ép sinh → parse được ngay, không cần bóc tách
    const parsed = JSON.parse(content) as Record<string, unknown>
    expect(typeof parsed['title']).toBe('string')
    expect(Array.isArray(parsed['skills'])).toBe(true)
    expect(Object.keys(parsed).sort()).toEqual(['skills', 'title'])
  })

  it('KHÔNG có constrained decoding, schema 12 field hay hỏng — lý do phải bật', async () => {
    // Test tư liệu: ghi lại vì sao constrainedOutput mặc định là true.
    // Không assert model phải hỏng (không deterministic), chỉ ghi nhận kết quả.
    const p = new LlamaCppProvider('local.reasoner', {
      baseUrl: modelBaseUrl(cfg, 'reasoner'),
    })
    const sections = await parseJDTask.buildSections({
      language: 'vi',
      rawText: 'Tuyển Backend Developer (Fresher). Yêu cầu Node.js, PostgreSQL, Git.',
    })
    const res = await p.chat({
      messages: sections.map((s) => ({ role: s.role, content: s.content })),
      maxTokens: 900,
      temperature: 0,
      // cố tình KHÔNG truyền jsonSchema
    })
    let valid = false
    try {
      parseJDTask.schema.parse(JSON.parse(res.text))
      valid = true
    } catch {
      valid = false
    }
    console.log(`  ↳ không constrained decoding: schema hợp lệ = ${valid}`)
    expect(typeof valid).toBe('boolean')
  })
})

// ── Tokenization tiếng Việt (nền tảng của toàn bộ ngân sách §6) ─────────────

describe('TC-NF-04 — tỉ lệ token tiếng Việt / tiếng Anh', () => {
  it('nằm trong khoảng 1.2–1.45 (đo được 1.29)', async () => {
    const p = new LlamaCppProvider('local.reasoner', {
      baseUrl: modelBaseUrl(cfg, 'reasoner'),
    })
    const vi = await p.countTokens(
      'Xây dựng ứng dụng thương mại điện tử một trang bằng ReactJS và NodeJS, ' +
        'phục vụ hơn 500 sản phẩm, tối ưu thời gian tải trang từ 3.2 giây xuống còn 0.8 giây.',
    )
    const en = await p.countTokens(
      'Built a single-page e-commerce application with ReactJS and NodeJS serving ' +
        'over 500 products, optimizing page load time from 3.2 seconds to 0.8 seconds.',
    )
    const ratio = vi / en
    expect(ratio).toBeGreaterThan(1.2)
    expect(ratio).toBeLessThan(1.45)
    expect(Math.abs(ratio - VI_EN_TOKEN_RATIO)).toBeLessThan(0.2)
  })
})

// ── End-to-end task thật ────────────────────────────────────────────────────

describe('parse_jd end-to-end với model thật', () => {
  it('trích được yêu cầu từ JD tiếng Việt', async () => {
    const gw = new Gateway({ config: cfg, registry: new ProviderRegistry(cfg) })
    const res = await gw.run(parseJDTask, {
      language: 'vi',
      rawText: `Tuyển Backend Developer (Fresher)

YÊU CẦU
- Thành thạo Node.js, hiểu về RESTful API
- Biết PostgreSQL hoặc MySQL
- Sử dụng được Git

ƯU TIÊN
- Có kinh nghiệm với Docker

QUYỀN LỢI
- Lương thoả thuận, review 2 lần/năm`,
    })

    if (!res.ok) {
      throw new Error(
        `parse_jd thất bại: ${res.error.code} — ${res.error.message}\n` +
          `meta=${JSON.stringify(res.meta)}`,
      )
    }
    expect(res.data.roleFamily).toBe('backend_developer')
    expect(res.data.seniority).toBe('fresher')
    const skills = res.data.hardSkills.join(' ').toLowerCase()
    expect(skills).toContain('node')
    expect(res.meta.promptTokens).toBeGreaterThan(0)
    expect(res.meta.schemaValid).toBe(true)

    console.log(
      `  ↳ parse_jd: ${res.meta.latencyMs}ms · ${res.meta.promptTokens} prompt tok · ` +
        `${res.meta.completionTokens} out tok · ${res.meta.attempts} lần thử · ` +
        `escalated=${res.meta.escalated}`,
    )
  })
})
