'use client'

import { useEffect, useState } from 'react'

/**
 * Màn hình báo cáo đối chiếu — UC-42, FRONTEND §5.2.
 *
 * Ràng buộc 70 giây được giải bằng cách CHIA HAI LỚP TỐC ĐỘ:
 *   · điểm + danh sách khoảng trống → có sau ~5 giây, render ngay
 *   · lời khuyên bằng chữ           → điền dần vào khung đã dựng sẵn
 *
 * Người dùng thấy kết quả sau 5 giây, không phải 70.
 */

export interface Report {
  ready: boolean
  id?: string
  jd?: { id: string; title: string | null; seniority: string | null }
  overall?: number
  breakdown?: Record<string, number>
  matched?: { requirement: string; evidence: { path: string; excerpt: string }[]; strength: string }[]
  gaps?: {
    id: string
    requirement: string
    severity: 'high' | 'medium' | 'low'
    reason: 'missing' | 'implicit' | 'below_threshold'
    advice: string | null
    kbRefs: string[]
  }[]
  missingAtsKeywords?: string[]
  degraded?: boolean
  degradedReason?: string | null
  advicePending?: number
}

const LABEL: Record<string, string> = {
  skills: 'Kỹ năng',
  experience: 'Ngữ nghĩa',
  education: 'Kinh nghiệm',
  keywords: 'Từ khoá ATS',
  rubric: 'Chất lượng CV',
}

const SEVERITY: Record<string, { dot: string; text: string }> = {
  high: { dot: '🔴', text: 'JD yêu cầu · CV chưa nhắc tới' },
  medium: { dot: '🟠', text: 'CV có nhắc gián tiếp' },
  low: { dot: '🟡', text: 'Nên cải thiện' },
}

const REASON: Record<string, string> = {
  missing: 'JD yêu cầu · CV chưa nhắc tới',
  implicit: 'CV có thể hiện nhưng KHÔNG dùng đúng từ JD dùng — hệ thống lọc tự động sẽ bỏ sót',
  below_threshold: 'Chưa đạt mức HR kỳ vọng',
}

export function ReportView({ cvId, jobId }: { cvId: string; jobId?: string }) {
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Poll cho tới khi lời khuyên soạn xong. Poll chứ không SSE: dữ liệu này là
  // ảnh chụp toàn phần, không phải luồng sự kiện — tải lại cả bản đơn giản hơn
  // và không sợ lệch trạng thái khi mất kết nối giữa chừng.
  useEffect(() => {
    let stop = false
    let tries = 0

    const tick = async (): Promise<void> => {
      try {
        const res = await fetch(`/api/analyze/${cvId}`)
        const data = (await res.json()) as Report
        if (stop) return
        setReport(data)

        const done = data.ready && (data.advicePending ?? 0) === 0
        // Trần 120 lượt ≈ 4 phút: job có thể hỏng ở bước tư vấn, và poll mãi
        // sẽ đốt pin máy người dùng mà không bao giờ dừng
        if (!done && tries++ < 120) setTimeout(() => void tick(), 2_000)
      } catch (e) {
        if (!stop) setError((e as Error).message)
      }
    }
    void tick()
    return () => {
      stop = true
    }
  }, [cvId])

  if (error) {
    return (
      <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm">
        Chưa tải được kết quả: {error}
      </p>
    )
  }

  if (!report?.ready) {
    return (
      <section className="space-y-3">
        <p className="text-neutral-600 dark:text-neutral-400">
          Đang đối chiếu CV với mô tả công việc…
        </p>
        <div className="h-24 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-800" />
        <div className="h-40 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-800" />
        {jobId && <p className="text-xs text-neutral-400">Mã phiên: {jobId}</p>}
      </section>
    )
  }

  const gaps = report.gaps ?? []

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">
          Đối chiếu với: {report.jd?.title || 'Tin tuyển dụng'}
          {report.jd?.seniority && report.jd.seniority !== 'unknown' && (
            <span className="ml-2 text-sm font-normal text-neutral-500">
              ({report.jd.seniority})
            </span>
          )}
        </h1>
      </header>

      {report.degraded && (
        <p
          role="status"
          className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/30"
        >
          {report.degradedReason ??
            'Đang dùng đối chiếu từ khoá. Phân tích ngữ nghĩa tạm không khả dụng.'}
        </p>
      )}

      {/* ── Điểm ─────────────────────────────────────────────────────── */}
      <section className="flex flex-wrap items-center gap-8 rounded-lg border border-neutral-200 p-5 dark:border-neutral-700">
        <div className="text-center">
          <div className="text-4xl font-bold tabular-nums">{report.overall}</div>
          <div className="text-xs text-neutral-500">/100</div>
        </div>
        <dl className="min-w-[240px] flex-1 space-y-1.5">
          {Object.entries(report.breakdown ?? {}).map(([k, v]) => (
            <div key={k} className="flex items-center gap-3 text-sm">
              <dt className="w-28 shrink-0 text-neutral-600 dark:text-neutral-400">
                {LABEL[k] ?? k}
              </dt>
              <dd className="flex flex-1 items-center gap-2">
                <span
                  className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700"
                  aria-hidden
                >
                  <span
                    className="block h-full rounded-full bg-sky-600"
                    style={{ width: `${v}%` }}
                  />
                </span>
                <span className="w-8 text-right tabular-nums">{v}</span>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ── Đã khớp ──────────────────────────────────────────────────── */}
      {(report.matched?.length ?? 0) > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Đã khớp ({report.matched!.length})
          </h2>
          <ul className="space-y-1.5">
            {report.matched!.map((m) => (
              <li key={m.requirement} className="flex flex-wrap items-baseline gap-2 text-sm">
                <span className="text-emerald-600">✓</span>
                <span className="font-medium">{m.requirement}</span>
                {m.evidence[0] && (
                  // Bằng chứng luôn hiện ra: user phải kiểm chứng được, và
                  // không có nó thì con số chỉ là lời khẳng định suông
                  <span className="text-neutral-500">
                    ← “{m.evidence[0].excerpt}”
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Còn thiếu ────────────────────────────────────────────────── */}
      {gaps.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Còn thiếu ({gaps.length})
            {(report.advicePending ?? 0) > 0 && (
              <span className="ml-2 font-normal normal-case text-neutral-400">
                đang soạn lời khuyên cho {report.advicePending} mục…
              </span>
            )}
          </h2>
          <ul className="space-y-3">
            {gaps.map((g) => (
              <li
                key={g.id}
                className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-700"
              >
                <div className="flex flex-wrap items-baseline gap-2 text-sm">
                  <span aria-hidden>{SEVERITY[g.severity]?.dot}</span>
                  <span className="font-medium">{g.requirement}</span>
                  <span className="text-xs text-neutral-500">{REASON[g.reason]}</span>
                </div>

                {g.advice ? (
                  <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">
                    💬 {g.advice}
                    {g.kbRefs.length === 0 && (
                      // §10.4: lời khuyên không có nguồn phải hiện khác đi —
                      // vừa tạo niềm tin, vừa là công cụ gỡ lỗi
                      <span className="ml-2 text-xs text-neutral-400">(gợi ý chung của AI)</span>
                    )}
                  </p>
                ) : (
                  <div
                    className="mt-2 h-4 w-3/4 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800"
                    aria-label="đang soạn lời khuyên"
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Từ khoá ATS ──────────────────────────────────────────────── */}
      {(report.missingAtsKeywords?.length ?? 0) > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Từ khoá ATS còn thiếu ({report.missingAtsKeywords!.length})
          </h2>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            {report.missingAtsKeywords!.join(' · ')}
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            Hệ thống lọc hồ sơ tự động quét đúng chuỗi trong tin tuyển dụng — nó không
            biết “ReactJS” và “React” là một.
          </p>
        </section>
      )}
    </div>
  )
}
