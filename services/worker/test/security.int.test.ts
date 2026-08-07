import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import pg from 'pg'
import { Gateway, detectPII, redactSections, type CallMeta } from '@hr/ai'
import { JobError, JobRepo, ProfileRepo, type JobRow } from '@hr/db'
import { PdfkitClient } from '../src/pdfkit-client.js'
import { makeParseCvHandler } from '../src/handlers/parse-cv.js'
import type { Storage } from '../src/storage.js'
import type { JobContext } from '../src/runner.js'

/**
 * TC-SEC-01..06 — bảo mật & quyền riêng tư (TESTCASES §3.2, TDD §15).
 *
 * Chạy trên CV THẬT (`eval/cv/`, gitignored) vì đây chính là chỗ mà bộ regex
 * tự viết đã hai lần qua hết test mà vẫn để lọt PII trên dữ liệu thật.
 * Thiếu file thì skip, không fail.
 *
 *   docker compose up -d postgres pdfkit && npm run test:int
 */

const CV_DIR = resolve(import.meta.dirname, '../../../eval/cv')
const DB = process.env.DATABASE_URL ?? 'postgres://postgres:hragent_dev@localhost:5433/hragent'

/** Mọi CV có sẵn — càng nhiều dạng viết càng tốt cho lớp che PII. */
const CV_NAMES = ['CV-01', 'CV-02', 'CV-04', 'CV-06', 'CV-07', 'CV-10']

let pool: pg.Pool
let pdfkit: PdfkitClient
const available: string[] = []
let dbUp = false

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: DB, max: 4, connectionTimeoutMillis: 3_000 })
  dbUp = await pool.query('SELECT 1 FROM jobs LIMIT 1').then(
    () => true,
    () => false,
  )
  pdfkit = new PdfkitClient()
  if (!(await pdfkit.health())) return

  for (const n of CV_NAMES) {
    if (await readFile(`${CV_DIR}/${n}.pdf`).then(() => true, () => false)) available.push(n)
  }
}, 60_000)

afterAll(async () => {
  await pool?.end()
})

/** Gateway giả: KHÔNG gọi mạng, chỉ ghi lại mọi thứ định gửi đi. */
function capturingGateway(): { gateway: Gateway; sent: string[] } {
  const sent: string[] = []
  const gateway = {
    run: async (task: { buildSections: (i: unknown) => { content: string }[] }, input: unknown) => {
      for (const s of task.buildSections(input)) sent.push(s.content)
      return { ok: true as const, data: { items: [] }, meta: {} as CallMeta }
    },
  } as unknown as Gateway
  return { gateway, sent }
}

function ctx(payload: Record<string, unknown>, userId = 'u-1'): JobContext {
  return {
    job: {
      id: 'job-sec',
      userId,
      kind: 'parse_cv',
      idempotencyKey: 'k',
      status: 'running',
      payload,
      result: null,
      error: null,
      attempts: 1,
      createdAt: new Date(0),
      startedAt: null,
      finishedAt: null,
    } satisfies JobRow,
    progress: async () => {},
    attempt: 1,
    hasMoreAttempts: false,
  }
}

// ── TC-SEC-01 ──────────────────────────────────────────────────────────────

describe('TC-SEC-01 — PII không rời khỏi hệ thống', () => {
  it('không payload nào gửi tới model chứa PII của CV thật', async () => {
    if (available.length === 0) {
      console.warn('⏭  thiếu CV thật hoặc pdfkit — bỏ qua TC-SEC-01')
      return
    }

    const failures: string[] = []

    for (const name of available) {
      const pdf = new Uint8Array(await readFile(`${CV_DIR}/${name}.pdf`))
      const { gateway, sent } = capturingGateway()

      const handler = makeParseCvHandler({
        gateway,
        pdfkit,
        storage: { get: async () => pdf } as unknown as Storage,
        profiles: { create: async () => ({ id: 'p', profile: {} }) } as unknown as ProfileRepo,
      })

      await handler(ctx({ storageKey: 'x', filename: `${name}.pdf` })).catch(() => {
        // PARSE_EMPTY là bình thường ở đây: gateway giả luôn trả items rỗng.
        // Thứ đang kiểm chứng là NỘI DUNG đã gửi đi, không phải kết quả parse.
      })

      expect(sent.length, `${name}: không gửi gì cả, test vô nghĩa`).toBeGreaterThan(0)

      for (const payload of sent) {
        for (const leak of detectPII(payload)) {
          failures.push(`${name}: lọt ${leak.kind} "${leak.sample}"`)
        }
      }
    }

    expect(failures, failures.join('\n')).toEqual([])
  }, 120_000)

  it('tên thật cũng không lọt — detectPII không bắt được tên nên phải kiểm riêng', async () => {
    if (available.length === 0) return

    const failures: string[] = []
    for (const name of available) {
      const pdf = new Uint8Array(await readFile(`${CV_DIR}/${name}.pdf`))
      const seg = await pdfkit.segment(pdf, `${name}.pdf`)
      const red = redactSections(seg.text, seg.merged ?? {})
      const realName = red.map.NAME

      if (!realName) {
        // Không nhận ra tên là một dạng hỏng khác: nó nghĩa là tên KHÔNG bị che
        failures.push(`${name}: không nhận ra dòng tên → tên thật sẽ đi tới model`)
        continue
      }
      for (const [kind, body] of Object.entries(red.sections)) {
        if (body.includes(realName)) failures.push(`${name}/${kind}: còn nguyên tên thật`)
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 120_000)
})

// ── TC-SEC-02 ──────────────────────────────────────────────────────────────

describe('TC-SEC-02 — che PII hỏng thì DỪNG', () => {
  it('lỗi ở bước che → KHÔNG gọi model lần nào', async () => {
    const { gateway, sent } = capturingGateway()
    const handler = makeParseCvHandler({
      gateway,
      // pdfkit ném lỗi ⇒ chưa có text ⇒ chưa tới bước che ⇒ không được gọi model
      pdfkit: {
        segment: async () => {
          throw new JobError('PDFKIT_UNAVAILABLE', 'chết', true)
        },
      } as unknown as PdfkitClient,
      storage: { get: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]) } as unknown as Storage,
      profiles: { create: async () => ({ id: 'p', profile: {} }) } as unknown as ProfileRepo,
    })

    await expect(handler(ctx({ storageKey: 'x' }))).rejects.toBeInstanceOf(JobError)
    expect(sent, 'đã gửi payload dù bước trước hỏng').toEqual([])
  })

  it('không có text layer → dừng trước mọi lời gọi model', async () => {
    const { gateway, sent } = capturingGateway()
    const handler = makeParseCvHandler({
      gateway,
      pdfkit: {
        segment: async () => ({
          text: '',
          engine: 'none',
          quality: 'none',
          reasons: ['không có text layer'],
          pages: 1,
          columns: 1,
          hasType3: false,
          garbleCount: 0,
          engineDiff: 0,
          fonts: [],
          sections: [],
          merged: {},
        }),
      } as unknown as PdfkitClient,
      storage: { get: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]) } as unknown as Storage,
      profiles: { create: async () => ({ id: 'p', profile: {} }) } as unknown as ProfileRepo,
    })

    await expect(handler(ctx({ storageKey: 'x' }))).rejects.toMatchObject({
      code: 'NO_TEXT_LAYER',
    })
    expect(sent).toEqual([])
  })
})

// ── TC-SEC-04 ──────────────────────────────────────────────────────────────

describe('TC-SEC-04 — llm_calls chỉ lưu metric', () => {
  it('bảng không có cột nào chứa được nội dung prompt', async () => {
    if (!dbUp) return

    const { rows } = await pool.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_name = 'llm_calls'`,
    )
    expect(rows.length).toBeGreaterThan(0)

    // Chặn ở tầng LƯỢC ĐỒ, không phải tầng "nhớ đừng ghi": chỉ cần một cột text
    // tự do là ai đó sẽ ghi prompt vào đó, và không ai phát hiện ra.
    const freeText = rows.filter(
      (r) =>
        (r.data_type === 'text' || r.data_type.includes('character')) &&
        !['task', 'provider', 'model', 'error_code'].includes(r.column_name),
    )
    expect(freeText.map((r) => r.column_name), 'có cột text tự do').toEqual([])
  })

  it('dữ liệu đã ghi không chứa dấu vết nội dung CV', async () => {
    if (!dbUp) return
    const { rows } = await pool.query<Record<string, unknown>>(
      'SELECT * FROM llm_calls ORDER BY id DESC LIMIT 200',
    )
    const failures: string[] = []
    for (const r of rows) {
      for (const [k, v] of Object.entries(r)) {
        if (typeof v !== 'string') continue
        // Giá trị hợp lệ đều ngắn (tên task, tên model, mã lỗi). Chuỗi dài là
        // dấu hiệu ai đó đã nhét nội dung vào.
        if (v.length > 120) failures.push(`${k}: chuỗi dài ${v.length} ký tự`)
        for (const leak of detectPII(v)) failures.push(`${k}: lọt ${leak.kind}`)
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  })
})

// ── TC-SEC-06 ──────────────────────────────────────────────────────────────

describe('TC-SEC-06 — PII vẫn hiện ở màn rà soát', () => {
  it('danh tính thật được ghép lại vào hồ sơ để user soát (BR-22.3)', async () => {
    if (available.length === 0) return

    // Che rồi phải GẮN LẠI được: che mà mất luôn thì user không rà soát nổi
    const pdf = new Uint8Array(await readFile(`${CV_DIR}/${available[0]}.pdf`))
    const seg = await pdfkit.segment(pdf, 'cv.pdf')
    const red = redactSections(seg.text, seg.merged ?? {})

    expect(red.map.NAME, 'không giữ lại tên để gắn về sau').toBeTruthy()
    expect(red.count, 'không che được gì').toBeGreaterThan(0)
  }, 60_000)
})

// ── Hồi quy: guard và lớp che phải dùng CÙNG bộ mẫu ────────────────────────

describe('detectPII (guard) mạnh ngang lớp che', () => {
  const PHONES = [
    '+8491 234 5678',
    '+84900112233',
    '(+84) 912345678',
    '+84 987654321',
    '0901234567',
    '0312345678',
  ]

  it.each(PHONES)('guard bắt được %s', (phone) => {
    // Guard từng có bản sao regex yếu hơn và bỏ sót đúng hai dạng có ngoặc /
    // dấu cách — hàng phòng thủ cuối chỉ bắt được thứ lớp trước đã bắt thì
    // không phòng thủ gì cả (TDD §15.2.1).
    const leaks = detectPII(`Liên hệ ${phone}`)
    expect(leaks.map((l) => l.kind)).toContain('phone')
  })

  it('guard bắt email và ngày sinh', () => {
    expect(detectPII('a.b@gmail.com').map((l) => l.kind)).toContain('email')
    expect(detectPII('20/07/1999').map((l) => l.kind)).toContain('dob')
  })

  it('text đã che thì guard im lặng', () => {
    expect(detectPII('<NAME>\n<EMAIL> | <PHONE>\n<DOB>')).toEqual([])
  })
})

// ── Chống lọt PII vào kho chứa job ────────────────────────────────────────

describe('kết quả job không chứa PII', () => {
  it('`jobs.result` chỉ có metric và id, không có nội dung CV', async () => {
    if (!dbUp) return
    const repo = new JobRepo(pool)
    const jobs = await pool
      .query<{ id: string }>("SELECT id FROM jobs WHERE status = 'done' LIMIT 20")
      .then((r) => r.rows)

    const failures: string[] = []
    for (const { id } of jobs) {
      const job = await repo.get(id)
      const text = JSON.stringify(job?.result ?? {})
      for (const leak of detectPII(text)) failures.push(`job ${id}: lọt ${leak.kind}`)
      if (text.length > 4_000) failures.push(`job ${id}: result quá lớn (${text.length})`)
    }
    expect(failures, failures.join('\n')).toEqual([])
  })
})
