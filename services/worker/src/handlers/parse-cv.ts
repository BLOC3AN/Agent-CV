import {
  Gateway,
  sectionTask,
  redactSections,
  identityFromMap,
  type ParseableSection,
} from '@hr/ai'
import { JobError, type ProfileRepo } from '@hr/db'
import { assembleProfile, ParsedProfileSchema, type Language } from '@hr/schema'
import type { JobContext } from '../runner.js'
import type { PdfkitClient, SegmentResult, TextQuality } from '../pdfkit-client.js'
import type { Storage } from '../storage.js'
import { chunkSection } from '../cv-chunk.js'

/**
 * Job `parse_cv` — hiện thực luồng F1 ở TDD §8.1.
 *
 *   [1] pdfkit: trích text + cổng chất lượng + chia mục
 *   [2] cổng chất lượng quyết định nhánh (§8.1.1)
 *   [3] che PII bằng CODE trước mọi lần gọi model (§15.2 R1)
 *   [4] parse TỪNG MỤC, không parse cả CV một lượt (§8.1.2)
 *   [5] ghép danh tính trở lại, đánh dấu verified = false toàn bộ
 *   [6] trả kết quả → màn hình rà soát BẮT BUỘC (UC-22)
 */

/** Mục nào có task parse. `summary`/`awards`/`unknown` không có schema riêng. */
const PARSEABLE: ParseableSection[] = [
  'education',
  'work',
  'projects',
  'skills',
  'activities',
  'certifications',
  'languages',
]

export interface ParseCvPayload {
  storageKey: string
  filename?: string
  outputLanguage?: Language
}

export interface ParseCvDeps {
  gateway: Gateway
  pdfkit: PdfkitClient
  storage: Storage
  profiles: ProfileRepo
  /** Đường ảnh (OCR). Chưa bật — xem TDD §2.6. */
  ocrEnabled?: boolean
}

export interface SectionOutcome {
  kind: ParseableSection
  status: 'parsed' | 'empty' | 'failed'
  count: number
  errorCode?: string
  /** Số khúc mục này bị chia (1 = không chia) — xem cv-chunk.ts */
  chunks?: number
  /** Khúc parse hỏng: mục vẫn có kết quả nhưng THIẾU, màn rà soát phải nói rõ */
  failedChunks?: number
}

/**
 * Mỗi lượt gọi model nhận tối đa bao nhiêu ký tự của một mục.
 *
 * Chọn 1800: chỗ làm dài nhất trong bộ CV thật là ~1900 ký tự, và output tiếng
 * Việt của một khúc cỡ đó vào khoảng 1100–1400 token — vừa trong `maxTokens`
 * 2200 của `parse_cv_to_profile` mà còn dư chỗ.
 */
const SECTION_CHUNK_CHARS = 1_800

/**
 * Cổng chất lượng → nhánh xử lý (TDD §8.1.1).
 *
 * Tách thành hàm thuần để test được không cần model: đây là chỗ quyết định
 * user nhận CV parse xong hay lời mời nhập tay.
 */
export function decideRoute(
  quality: TextQuality,
  ocrEnabled: boolean,
): { route: 'text' | 'image' | 'manual'; warn: boolean } {
  if (quality === 'none') return ocrEnabled ? { route: 'image', warn: false } : { route: 'manual', warn: false }
  if (quality === 'suspect') {
    // Không có OCR thì vẫn dùng text — nhưng phải cảnh báo, vì text đáng ngờ
    // mà im lặng sẽ khiến user tin vào dữ liệu sai.
    return ocrEnabled ? { route: 'image', warn: false } : { route: 'text', warn: true }
  }
  return { route: 'text', warn: false }
}

export function makeParseCvHandler(deps: ParseCvDeps) {
  const ocrEnabled = deps.ocrEnabled ?? false

  return async function parseCv(ctx: JobContext): Promise<Record<string, unknown>> {
    const payload = ctx.job.payload as unknown as ParseCvPayload
    if (!payload?.storageKey) {
      throw new JobError('BAD_PAYLOAD', 'Thiếu storageKey trong payload')
    }
    // `profiles.user_id` là NOT NULL — profile luôn thuộc về một người. Kiểm ở
    // ĐÂY chứ không để Postgres ném "invalid input syntax for type uuid" sau
    // khi đã tốn cả phút gọi model.
    if (!ctx.job.userId) {
      throw new JobError('NO_USER', 'Job parse CV phải gắn với một tài khoản')
    }
    const lang: Language = payload.outputLanguage ?? 'vi'

    // ── [1] Trích text + chia mục ─────────────────────────────────────────
    await ctx.progress(5, 'Đang đọc file PDF')
    const pdf = await deps.storage.get(payload.storageKey)
    const seg: SegmentResult = await deps.pdfkit.segment(pdf, payload.filename ?? 'cv.pdf')

    // ── [2] Cổng chất lượng ───────────────────────────────────────────────
    const { route, warn } = decideRoute(seg.quality, ocrEnabled)

    if (route === 'manual') {
      // Dừng CÓ KIỂM SOÁT, không phải crash. Mã lỗi để FE hiện lời mời nhập
      // tay thay vì màn hình lỗi trắng (BR-71.1).
      throw new JobError(
        'NO_TEXT_LAYER',
        'File này là ảnh scan, chưa đọc được chữ. Bạn nhập tay giúp nhé.',
        false,
        { pages: seg.pages, reasons: seg.reasons },
      )
    }
    if (route === 'image') {
      throw new JobError('OCR_NOT_IMPLEMENTED', 'Đường ảnh chưa bật (TDD §2.6)', false)
    }

    const sections = seg.merged ?? {}
    const available = PARSEABLE.filter((k) => (sections[k] ?? '').trim().length > 20)
    if (available.length === 0) {
      throw new JobError(
        'NO_SECTIONS',
        'Không nhận ra mục nào trong CV (học vấn, kinh nghiệm, kỹ năng…). ' +
          'Có thể file dùng bố cục lạ — bạn nhập tay giúp nhé.',
        false,
        { quality: seg.quality, reasons: seg.reasons },
      )
    }

    // ── [3] Che PII — BẮT BUỘC, bằng code ────────────────────────────────
    await ctx.progress(15, 'Đang che thông tin cá nhân')
    const redacted = redactSections(seg.text, Object.fromEntries(
      available.map((k) => [k, sections[k]!]),
    ))
    const identity = identityFromMap(redacted.map)

    // ── [4] Parse từng mục ────────────────────────────────────────────────
    const parsed: Record<string, unknown[]> = {}
    const outcomes: SectionOutcome[] = []

    for (const [i, kind] of available.entries()) {
      // `sectionTask` cache theo loại — dựng lại JSON Schema mỗi lần gọi là phí
      const task = sectionTask(kind)

      /*
       * Mục dài đi từng khúc, mỗi khúc một chỗ làm (xem cv-chunk.ts).
       *
       * Không chia thì mục kinh nghiệm 5 chỗ làm cần nhiều token output hơn hạn
       * mức, JSON bị cắt giữa câu, và cả mục hỏng — người dùng đi từ "thấy 1
       * chỗ làm" xuống "thấy 0 chỗ làm".
       */
      const chunks = chunkSection(redacted.sections[kind]!, SECTION_CHUNK_CHARS)
      const items: unknown[] = []
      let failedChunks = 0
      let lastError: string | undefined

      for (const [ci, chunk] of chunks.entries()) {
        const done = (i + ci / chunks.length) / available.length
        const label =
          chunks.length > 1
            ? `Đang đọc mục ${kind} (phần ${ci + 1}/${chunks.length})`
            : `Đang đọc mục ${kind}`
        await ctx.progress(20 + done * 70, label)

        const res = await deps.gateway.run(task, {
          kind,
          text: chunk,
          outputLanguage: lang,
        })

        if (!res.ok) {
          // Một khúc hỏng KHÔNG được kéo đổ cả mục, cũng như một mục hỏng không
          // kéo đổ cả CV — user vẫn có phần còn lại để rà soát và bổ sung.
          failedChunks++
          lastError = res.error.code
          continue
        }

        // Kiểm lại hình dạng ở ĐÂY, không chỉ tin gateway đã validate.
        // Nếu một item lệch schema lọt qua, `ParsedProfileSchema.parse` cuối
        // luồng sẽ ném ZodError thô và giết cả CV — đúng thứ mà việc chia mục
        // sinh ra để tránh. Kiểm ở đây thì một khúc hỏng chỉ mất chính nó.
        const check = task.schema.safeParse(res.data)
        if (!check.success) {
          failedChunks++
          lastError = 'SCHEMA_INVALID'
          continue
        }

        items.push(...((check.data as { items?: unknown[] }).items ?? []))
      }

      parsed[kind] = items
      const status: SectionOutcome['status'] =
        items.length > 0 ? 'parsed' : failedChunks > 0 ? 'failed' : 'empty'
      outcomes.push({
        kind,
        status,
        count: items.length,
        ...(lastError ? { errorCode: lastError } : {}),
        ...(chunks.length > 1 ? { chunks: chunks.length } : {}),
        ...(failedChunks > 0 ? { failedChunks } : {}),
      })
    }

    const parsedCount = outcomes.filter((o) => o.status === 'parsed').length
    if (parsedCount === 0) {
      throw new JobError(
        'PARSE_EMPTY',
        'Không trích được nội dung nào từ CV. Bạn thử tải lại file khác hoặc nhập tay nhé.',
        false,
        { outcomes },
      )
    }

    // ── [5] Ghép danh tính, verified = false toàn bộ ─────────────────────
    await ctx.progress(93, 'Đang dựng hồ sơ')
    const assembled = ParsedProfileSchema.safeParse({
      schemaVersion: 1,
      language: lang,
      basics: {},
      ...parsed,
    })
    if (!assembled.success) {
      // Đã lọc từng mục ở trên nên đây gần như không xảy ra — nhưng nếu có thì
      // phải là lỗi CÓ MÃ, không phải ZodError thô lọt lên FE.
      throw new JobError('ASSEMBLE_FAILED', 'Không dựng được hồ sơ từ kết quả parse', false, {
        issues: assembled.error.issues.slice(0, 5),
      })
    }
    const profile = assembleProfile(assembled.data, identity, 'pdf_import')

    const saved = await deps.profiles.create(ctx.job.userId, profile)
    await ctx.progress(100, 'Xong')

    // ── [6] Kết quả cho màn hình rà soát ─────────────────────────────────
    return {
      profileId: saved.id,
      quality: seg.quality,
      qualityWarning: warn,
      reasons: seg.reasons,
      engine: seg.engine,
      pages: seg.pages,
      columns: seg.columns,
      piiRedacted: redacted.count,
      sections: outcomes,
      // Sự thật quan trọng nhất trả về FE: chưa có gì được xác nhận.
      needsReview: true,
    }
  }
}
