import { NextResponse } from 'next/server'
import { getPool } from '@hr/db'

/**
 * GET /api/analyze/:cvId — kết quả đối chiếu mới nhất của một CV (UC-42).
 *
 * Trả cả khi lời khuyên chưa soạn xong: điểm và danh sách khoảng trống có sau
 * ~5 giây, phần chữ điền dần vào sau (FRONTEND §5.1). Giao diện dựng khung từ
 * dữ liệu này rồi thay dần skeleton.
 */

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ cvId: string }> }) {
  const { cvId } = await params

  const { rows } = await getPool().query<{
    id: string
    score: { overall: number; breakdown: Record<string, number>; missingAtsKeywords?: string[]; degradedReason?: string | null }
    matched: unknown[]
    gaps: { id: string; requirement: string; severity: string; reason: string; advice: string | null; kbRefs: string[] }[]
    degraded: boolean
    created_at: Date
    jd_id: string
    jd_title: string | null
    jd_seniority: string | null
  }>(
    `SELECT m.id, m.score, m.matched, m.gaps, m.degraded, m.created_at,
            m.jd_id,
            j.requirements->>'title'     AS jd_title,
            j.requirements->>'seniority' AS jd_seniority
       FROM match_analyses m
       JOIN job_descriptions j ON j.id = m.jd_id
      WHERE m.cv_id = $1
      ORDER BY m.created_at DESC
      LIMIT 1`,
    [cvId],
  )

  if (rows.length === 0) {
    return NextResponse.json({ ready: false }, { status: 200 })
  }

  const r = rows[0]!
  const gaps = r.gaps ?? []

  return NextResponse.json({
    ready: true,
    id: r.id,
    jd: { id: r.jd_id, title: r.jd_title, seniority: r.jd_seniority },
    overall: r.score.overall,
    breakdown: r.score.breakdown,
    matched: r.matched ?? [],
    gaps,
    missingAtsKeywords: r.score.missingAtsKeywords ?? [],
    degraded: r.degraded,
    degradedReason: r.score.degradedReason ?? null,
    // Còn khoảng trống nào chưa có lời khuyên → giao diện giữ skeleton
    advicePending: gaps.filter((g) => g.advice === null).length,
    createdAt: r.created_at,
  })
}
