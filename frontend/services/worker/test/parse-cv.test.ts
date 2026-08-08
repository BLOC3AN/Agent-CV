import { describe, it, expect, vi } from 'vitest'
import { GatewayError, type Gateway } from '@hr/ai'
import { JobError, type ProfileRepo, type JobRow } from '@hr/db'
import { makeParseCvHandler, decideRoute, detectCvLanguage } from '../src/handlers/parse-cv.js'
import type { PdfkitClient, SegmentResult, TextQuality } from '../src/pdfkit-client.js'
import type { Storage } from '../src/storage.js'
import type { JobContext } from '../src/runner.js'

/**
 * Test luồng F1 (TDD §8.1) không cần model, không cần pdfkit thật.
 *
 * Trọng tâm là các quyết định RẼ NHÁNH — chúng định đoạt user nhận CV parse
 * xong, nhận cảnh báo, hay nhận lời mời nhập tay. Chất lượng parse của model là
 * việc của bộ eval (`eval/`), không phải của test này.
 */

const CV_TEXT = `Nguyễn Văn An
Backend Developer
an.nguyen@gmail.com | 0912345678

HỌC VẤN
Đại học Bách Khoa Hà Nội — Kỹ sư CNTT, 2020-2024, GPA 3.4

KINH NGHIỆM
Thực tập sinh Backend — Công ty ABC, 6/2023 - 12/2023
- Xây dựng API bằng NodeJS
`

function seg(over: Partial<SegmentResult> = {}): SegmentResult {
  return {
    text: CV_TEXT,
    engine: 'pymupdf',
    quality: 'good',
    reasons: [],
    pages: 1,
    columns: 1,
    hasType3: false,
    garbleCount: 0,
    engineDiff: 0,
    fonts: ['TrueType ArialMT'],
    sections: [],
    merged: {
      education: 'Đại học Bách Khoa Hà Nội — Kỹ sư CNTT, 2020-2024, GPA 3.4',
      work: 'Thực tập sinh Backend — Công ty ABC, 6/2023 - 12/2023\n- Xây dựng API bằng NodeJS',
    },
    ...over,
  }
}

/** Item hợp lệ theo schema thật của từng mục — model thật cũng trả dạng này. */
const ITEMS: Record<string, unknown[]> = {
  education: [{ school: 'Đại học Bách Khoa Hà Nội', degree: 'Kỹ sư CNTT', highlights: [] }],
  work: [{ org: 'Công ty ABC', role: 'Thực tập sinh Backend', highlights: ['Xây dựng API'] }],
}

interface Harness {
  handler: ReturnType<typeof makeParseCvHandler>
  runs: { taskName: string; input: { kind: string; text: string } }[]
  created: { userId: string; profile: unknown }[]
}

function harness(opts: {
  segment?: Partial<SegmentResult>
  ocrEnabled?: boolean
  gatewayResult?: (kind: string) => { ok: boolean; items?: unknown[]; code?: string }
} = {}): Harness {
  const runs: Harness['runs'] = []
  const created: Harness['created'] = []

  const gateway = {
    run: vi.fn(async (task: { name: string }, input: { kind: string; text: string }) => {
      runs.push({ taskName: task.name, input })
      const r = opts.gatewayResult?.(input.kind) ?? { ok: true, items: ITEMS[input.kind] ?? [] }
      if (!r.ok) {
        return {
          ok: false as const,
          error: new GatewayError((r.code ?? 'SCHEMA_INVALID') as 'SCHEMA_INVALID', 'hỏng'),
          meta: {} as never,
        }
      }
      return { ok: true as const, data: { items: r.items ?? [] }, meta: {} as never }
    }),
  } as unknown as Gateway

  const pdfkit = {
    segment: vi.fn(async () => seg(opts.segment)),
  } as unknown as PdfkitClient

  const storage = {
    get: vi.fn(async () => new Uint8Array([0x25, 0x50, 0x44, 0x46])),
  } as unknown as Storage

  const profiles = {
    create: vi.fn(async (userId: string, profile: unknown) => {
      created.push({ userId, profile })
      return { id: 'profile-1', profile }
    }),
  } as unknown as ProfileRepo

  return {
    handler: makeParseCvHandler({
      gateway,
      pdfkit,
      storage,
      profiles,
      ocrEnabled: opts.ocrEnabled ?? false,
    }),
    runs,
    created,
  }
}

function ctx(payload: Record<string, unknown> = { storageKey: 'ab/cd.pdf' }): JobContext {
  return {
    job: {
      id: 'job-1',
      userId: 'user-1',
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

// ── Cổng chất lượng → nhánh ────────────────────────────────────────────────

describe('decideRoute — TDD §8.1.1', () => {
  const cases: [TextQuality, boolean, string, boolean][] = [
    // quality,    ocr,   route,    warn
    ['good', true, 'text', false],
    ['good', false, 'text', false],
    ['suspect', true, 'image', false],
    ['suspect', false, 'text', true], // dùng text nhưng PHẢI cảnh báo
    ['none', true, 'image', false],
    ['none', false, 'manual', false],
  ]

  for (const [quality, ocr, route, warn] of cases) {
    it(`${quality} + ocr=${ocr} → ${route}${warn ? ' (cảnh báo)' : ''}`, () => {
      expect(decideRoute(quality, ocr)).toEqual({ route, warn })
    })
  }

  it('thiếu OCR làm GIẢM chất lượng, không làm SẬP luồng', () => {
    // 'good' vẫn chạy bình thường — đây là phần lớn CV thật
    expect(decideRoute('good', false).route).toBe('text')
    // 'suspect' vẫn ra kết quả, chỉ kèm cảnh báo
    expect(decideRoute('suspect', false).route).toBe('text')
  })
})

describe('detectCvLanguage — import giữ ngôn ngữ CV', () => {
  it('nhận CV tiếng Anh', () => {
    expect(detectCvLanguage('Education\nWork Experience\nSkills\nPresent')).toBe('en')
  })

  it('nhận CV tiếng Việt', () => {
    expect(detectCvLanguage('HỌC VẤN\nKinh nghiệm làm việc\nKỹ năng\nHiện tại')).toBe('vi')
  })
})

// ── Luồng chính ────────────────────────────────────────────────────────────

describe('parse_cv', () => {
  it('CV sạch: parse từng mục rồi tạo profile', async () => {
    const h = harness()
    const out = await h.handler(ctx())

    expect(out['profileId']).toBe('profile-1')
    expect(out['needsReview']).toBe(true)
    expect(out['quality']).toBe('good')
    expect(out['qualityWarning']).toBe(false)
  })

  it('parse TỪNG MỤC, không parse cả CV một lượt — TDD §8.1.2', async () => {
    const h = harness()
    await h.handler(ctx())

    // Hai mục có nội dung → hai lần gọi riêng, mỗi lần chỉ chứa text mục đó
    expect(h.runs).toHaveLength(2)
    expect(h.runs.map((r) => r.input.kind).sort()).toEqual(['education', 'work'])
    expect(h.runs.find((r) => r.input.kind === 'education')!.input.text).not.toContain(
      'Thực tập sinh',
    )
  })

  it('PII bị che TRƯỚC khi gửi model — TDD §15.2 R1', async () => {
    const h = harness()
    const out = await h.handler(ctx())

    for (const r of h.runs) {
      expect(r.input.text).not.toContain('an.nguyen@gmail.com')
      expect(r.input.text).not.toContain('0912345678')
      expect(r.input.text).not.toContain('Nguyễn Văn An')
    }
    expect(out['piiRedacted']).toBeGreaterThan(0)
  })

  it('danh tính thật được ghép LẠI vào profile, không mất', async () => {
    const h = harness()
    await h.handler(ctx())

    const basics = (h.created[0]!.profile as { basics: Record<string, string> }).basics
    expect(basics['name']).toBe('Nguyễn Văn An')
    expect(basics['email']).toBe('an.nguyen@gmail.com')
  })

  it('mọi field đều verified = false sau khi import — UC-22', async () => {
    const h = harness()
    await h.handler(ctx())

    const meta = (h.created[0]!.profile as { _meta: { verified: object; source: string } })._meta
    expect(meta.verified).toEqual({})
    expect(meta.source).toBe('pdf_import')
  })

  it('một mục hỏng KHÔNG kéo đổ cả CV', async () => {
    const h = harness({
      gatewayResult: (kind) =>
        kind === 'work'
          ? { ok: false, code: 'SCHEMA_INVALID' }
          : { ok: true, items: ITEMS['education'] },
    })
    const out = await h.handler(ctx())

    expect(out['profileId']).toBe('profile-1')
    const sections = out['sections'] as { kind: string; status: string; errorCode?: string }[]
    expect(sections.find((s) => s.kind === 'work')).toMatchObject({
      status: 'failed',
      errorCode: 'SCHEMA_INVALID',
    })
    expect(sections.find((s) => s.kind === 'education')!.status).toBe('parsed')
  })

  /*
   * HỒI QUY CV-06 — CV 3 trang, 5 chỗ làm.
   *
   * Sau khi sửa bước chia mục, mục kinh nghiệm dài 5300 ký tự. Gửi một lượt thì
   * output vượt `maxTokens`, JSON đứt giữa câu và MẤT TRẮNG cả mục. Phải chia
   * thành từng chỗ làm rồi gộp kết quả.
   */
  describe('mục dài đi từng khúc — TDD §6.4 bước 5', () => {
    const LONG_WORK = [
      'EXPERIENCE',
      ...['iMESPRO', 'bTaskee', 'KANEKO SANGYO', 'VNG CORPORATION', 'REALTIME ROBOTIC'].flatMap(
        (org, i) => [
          org,
          'AI Engineer',
          `${2020 + i} – ${2021 + i}`,
          `• ${'Việc đã làm rất chi tiết và dài dòng ở đây. '.repeat(12)}`,
        ],
      ),
    ].join('\n')

    it('gọi model nhiều lượt, mỗi lượt một chỗ làm', async () => {
      const h = harness({ segment: { merged: { work: LONG_WORK } } })
      await h.handler(ctx())

      expect(h.runs.length).toBeGreaterThan(1)
      for (const r of h.runs) expect(r.input.kind).toBe('work')
      // Mỗi chỗ làm phải tới được model, không sót chỗ nào
      const sent = h.runs.map((r) => r.input.text).join('\n')
      for (const org of ['iMESPRO', 'bTaskee', 'KANEKO', 'VNG', 'REALTIME']) {
        expect(sent).toContain(org)
      }
    })

    it('gộp item của mọi khúc, không chỉ lấy khúc cuối', async () => {
      const h = harness({ segment: { merged: { work: LONG_WORK } } })
      const out = await h.handler(ctx())

      const sections = out['sections'] as { kind: string; count: number; chunks?: number }[]
      const work = sections.find((s) => s.kind === 'work')!
      expect(work.chunks).toBe(h.runs.length)
      // Mock trả 1 item mỗi lượt → tổng phải bằng số lượt
      expect(work.count).toBe(h.runs.length)
    })

    it('một khúc hỏng chỉ mất khúc đó, phần còn lại vẫn về', async () => {
      let n = 0
      const h = harness({
        segment: { merged: { work: LONG_WORK } },
        gatewayResult: () => (++n === 2 ? { ok: false, code: 'SCHEMA_INVALID' } : { ok: true, items: ITEMS['work'] }),
      })
      const out = await h.handler(ctx())

      const work = (out['sections'] as { kind: string; status: string; count: number; failedChunks?: number }[])
        .find((s) => s.kind === 'work')!
      expect(work.status).toBe('parsed')
      expect(work.failedChunks).toBe(1)
      expect(work.count).toBe(h.runs.length - 1)
    })

    it('mục ngắn vẫn chỉ một lượt gọi — không sinh thêm chi phí', async () => {
      const h = harness()
      const res = await h.handler(ctx())

      expect(h.runs).toHaveLength(2)
      const sections = res['sections'] as { chunks?: number }[]
      expect(sections.every((s) => s.chunks === undefined)).toBe(true)
    })
  })

  it('MỌI mục hỏng → dừng có kiểm soát, không tạo profile rỗng', async () => {
    const h = harness({ gatewayResult: () => ({ ok: false }) })

    await expect(h.handler(ctx())).rejects.toMatchObject({ code: 'PARSE_EMPTY' })
    expect(h.created).toHaveLength(0)
  })
})

// ── Nhánh suy giảm ─────────────────────────────────────────────────────────

describe('parse_cv khi thiếu OCR — TDD §2.6', () => {
  it('không có text layer → NO_TEXT_LAYER, mã máy đọc được (BR-71.1)', async () => {
    const h = harness({ segment: { quality: 'none', text: '', merged: {}, reasons: ['không có text layer'] } })

    const err = await h.handler(ctx()).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(JobError)
    expect((err as JobError).code).toBe('NO_TEXT_LAYER')
    // Không đáng retry: file vẫn là ảnh scan ở lần thử sau
    expect((err as JobError).retryable).toBe(false)
    // Thông điệp phải là lời mời nhập tay, không phải mã lỗi kỹ thuật
    expect((err as JobError).message).toMatch(/nhập tay/)
  })

  it('text đáng ngờ vẫn parse nhưng gắn cờ cảnh báo', async () => {
    const h = harness({
      segment: { quality: 'suspect', reasons: ['có Type3 font', 'bố cục nhiều cột'] },
    })
    const out = await h.handler(ctx())

    expect(out['profileId']).toBe('profile-1')
    expect(out['qualityWarning']).toBe(true)
    expect(out['reasons']).toContain('có Type3 font')
  })

  it('bật OCR mà chưa cài đặt → báo rõ, không im lặng bỏ qua', async () => {
    const h = harness({ segment: { quality: 'none', merged: {} }, ocrEnabled: true })
    await expect(h.handler(ctx())).rejects.toMatchObject({ code: 'OCR_NOT_IMPLEMENTED' })
  })

  it('không nhận ra mục nào → mời nhập tay, không tạo profile rỗng', async () => {
    const h = harness({ segment: { merged: {} } })

    await expect(h.handler(ctx())).rejects.toMatchObject({ code: 'NO_SECTIONS' })
    expect(h.created).toHaveLength(0)
  })

  it('mục quá ngắn bị bỏ qua — đừng tốn lượt gọi model cho vài chữ', async () => {
    const h = harness({ segment: { merged: { education: 'ĐH', work: 'Công ty ABC — Thực tập sinh Backend 2023' } } })
    await h.handler(ctx())

    expect(h.runs.map((r) => r.input.kind)).toEqual(['work'])
  })

  it('thiếu storageKey → BAD_PAYLOAD, không gọi gì cả', async () => {
    const h = harness()
    await expect(h.handler(ctx({}))).rejects.toMatchObject({ code: 'BAD_PAYLOAD' })
    expect(h.runs).toHaveLength(0)
  })
})
