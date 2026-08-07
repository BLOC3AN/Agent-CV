import { Gateway, parseJDTask, gapAnalysisTask, stripPII } from '@hr/ai'
import { JobError, MatchRepo } from '@hr/db'
import type { JDRequirements, MatchResult } from '@hr/schema'
import { analyze, rubrics, taxonomy } from '@hr/matching'
import type { JobContext } from '../runner.js'

/**
 * Job `match_analysis` — luồng F2 ở TDD §8.2.
 *
 *   [1] parse_jd  (LLM, ~3 giây)
 *   [2] chấm ba lớp bằng CODE  (~2 giây)  ← điểm có ngay từ đây
 *   [3] gap_analysis  (LLM, ~30-70 giây)  ← lời khuyên điền dần vào sau
 *
 * Bước [2] xong là đã ghi kết quả xuống DB và báo tiến độ. Người dùng thấy
 * điểm sau ~5 giây thay vì chờ 70 giây — đây là lý do thực dụng của quyết định
 * "điểm tính bằng code, LLM chỉ diễn giải" (D3, FRONTEND §5.1).
 */

export interface MatchAnalysisPayload {
  cvId: string
  jdId: string
}

export interface MatchAnalysisDeps {
  gateway: Gateway
  repo: MatchRepo
  /** Nhúng ngữ nghĩa — `null` thì bỏ lớp 2, kết quả `degraded` */
  embedder?: { embedBatch(t: string[]): Promise<number[][]> } | null
  reranker?: {
    rerank(q: string, d: string[], n?: number): Promise<{ index: number; score: number }[]>
  } | null
  /** Lấy đoạn tri thức HR cho `gap_analysis` — M5-2 sẽ thay bằng bản thật */
  selectKb?: (ctx: {
    industry: string
    roleFamily: string
    seniority: string
    language: string
  }) => Promise<{ id: string; text: string }[]>
}

export function makeMatchAnalysisHandler(deps: MatchAnalysisDeps) {
  return async function matchAnalysis(ctx: JobContext): Promise<Record<string, unknown>> {
    const { cvId, jdId } = ctx.job.payload as unknown as MatchAnalysisPayload
    if (!cvId || !jdId) throw new JobError('BAD_PAYLOAD', 'Thiếu cvId hoặc jdId')

    const cv = await deps.repo.profileOfCv(cvId)
    if (!cv) throw new JobError('CV_NOT_FOUND', `Không tìm thấy CV ${cvId}`)

    const jdRow = await deps.repo.getJd(jdId)
    if (!jdRow) throw new JobError('JD_NOT_FOUND', `Không tìm thấy JD ${jdId}`)

    const revisionId = await deps.repo.latestRevision(cv.profileId)

    // BR-42.4: cache theo (cv, jd, bản sửa). Chưa sửa gì thì không phân tích lại.
    const cached = await deps.repo.findCached(cvId, jdId, revisionId)
    if (cached) {
      await ctx.progress(100, 'Dùng lại kết quả đã phân tích')
      return { matchId: null, cached: true, overall: cached.overall }
    }

    // ── [1] parse_jd ─────────────────────────────────────────────────────
    let jd: JDRequirements
    if (jdRow.requirements) {
      jd = jdRow.requirements
    } else {
      await ctx.progress(10, 'Đang đọc mô tả công việc')
      const parsed = await deps.gateway.run(parseJDTask, {
        rawText: jdRow.rawText,
        language: (jdRow.language === 'en' ? 'en' : 'vi') as 'vi' | 'en',
      })
      if (!parsed.ok) {
        throw new JobError(
          'JD_PARSE_FAILED',
          'Chưa đọc được yêu cầu từ mô tả công việc này. Bạn thử dán bản đầy đủ hơn nhé.',
          parsed.error.code === 'TIMEOUT' || parsed.error.code === 'MODEL_UNAVAILABLE',
        )
      }
      jd = parsed.data
      await deps.repo.setJdRequirements(jdId, jd)
    }

    // ── [2] Chấm ba lớp — THUẦN CODE ─────────────────────────────────────
    await ctx.progress(30, 'Đang đối chiếu với hồ sơ')
    const { match, layers } = await analyze({
      profile: cv.profile,
      jd,
      taxonomy: taxonomy(),
      rubrics: rubrics(),
      embedder: deps.embedder ?? null,
      reranker: deps.reranker ?? null,
      useRerank: true,
    })

    // Ghi NGAY khi có điểm. Nếu bước tư vấn phía sau hỏng, user vẫn có điểm và
    // danh sách khoảng trống — phần giá trị nhất đã nằm an toàn trong DB.
    const matchId = await deps.repo.saveMatch({
      cvId,
      jdId,
      revisionId,
      result: match,
      modelUsed: 'code',
    })
    await ctx.progress(55, `Đã chấm xong: ${match.overall}/100`)

    // ── [3] gap_analysis — LLM chỉ diễn giải ────────────────────────────
    let advised = 0
    if (match.gaps.length > 0) {
      await ctx.progress(60, 'Đang soạn lời khuyên')

      const kbChunks = deps.selectKb
        ? await deps
            .selectKb({
              industry: 'it_software',
              roleFamily: jd.roleFamily,
              seniority: jd.seniority,
              language: jd.language,
            })
            .catch(() => [])
        : []

      const res = await deps.gateway.run(gapAnalysisTask, {
        // stripPII BẮT BUỘC trước mọi lời gọi model (§15.2 R1)
        compactProfile: stripPII(cv.profile),
        jd: { title: jd.title, seniority: jd.seniority, roleFamily: jd.roleFamily },
        gaps: match.gaps.map((g) => ({
          id: g.id,
          requirement: g.requirement,
          severity: g.severity,
          reason: g.reason,
        })),
        kbChunks,
        outputLanguage: jd.language,
      })

      if (res.ok) {
        // Chỉ nhận lời khuyên cho gapId CÓ THẬT. Model bịa thêm gap thì bỏ —
        // danh sách khoảng trống do code quyết định, không phải model.
        const known = new Map(match.gaps.map((g) => [g.id, g]))
        for (const a of res.data.advices) {
          const g = known.get(a.gapId)
          if (!g) continue
          g.advice = a.advice
          g.kbRefs = a.kbRefs
          advised++
        }
        await deps.repo.saveMatch({
          cvId,
          jdId,
          revisionId,
          result: match,
          modelUsed: res.meta.model,
        })
      }
      // gap_analysis hỏng KHÔNG làm job thất bại: điểm và khoảng trống đã có,
      // chỉ thiếu lời khuyên bằng chữ. Báo qua `advised` để UI nói rõ.
    }

    await ctx.progress(100, 'Xong')

    return {
      matchId,
      cached: false,
      overall: match.overall,
      breakdown: match.breakdown,
      matchedCount: match.matched.length,
      gapCount: match.gaps.length,
      advisedCount: advised,
      degraded: match.degraded,
      degradedReason: match.degradedReason,
      layers: {
        keyword: layers.keyword.parts,
        semantic: layers.semantic.score,
        rubric: layers.rubric.score,
      },
    }
  }
}

export type { MatchResult }
