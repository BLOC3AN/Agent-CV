'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

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

interface Citation {
  chunkId: string
  authorName: string
  authorTitle: string | null
  excerpt: string
}

export function ReportView({ cvId, jobId }: { cvId: string; jobId?: string }) {
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [citations, setCitations] = useState<Record<string, Citation>>({})

  useEffect(() => {
    const source = new EventSource(`/api/analyze/${cvId}/stream`)
    source.addEventListener('report', (event) => {
      setReport(JSON.parse((event as MessageEvent<string>).data) as Report)
    })
    source.addEventListener('done', (event) => {
      setReport(JSON.parse((event as MessageEvent<string>).data) as Report)
      source.close()
    })
    source.addEventListener('error', (event) => {
      const data = (event as MessageEvent<string>).data
      if (data) setError((JSON.parse(data) as { message?: string }).message ?? 'Không đọc được báo cáo')
    })
    return () => {
      source.close()
    }
  }, [cvId])

  // Nạp trích dẫn cho những lời khuyên CÓ nguồn (§10.4). Tách khỏi lượt poll
  // chính: trích dẫn chỉ đổi khi lời khuyên đổi, không cần tải lại mỗi 2 giây.
  useEffect(() => {
    const refs = [...new Set((report?.gaps ?? []).flatMap((g) => g.kbRefs))]
    const missing = refs.filter((r) => !(r in citations))
    if (missing.length === 0) return

    let stop = false
    void fetch('/api/kb/citations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chunkIds: missing }),
    })
      .then((r) => r.json() as Promise<{ citations: Citation[] }>)
      .then((d) => {
        if (stop) return
        setCitations((c) => ({
          ...c,
          ...Object.fromEntries(d.citations.map((x) => [x.chunkId, x])),
        }))
      })
      .catch(() => {})
    return () => {
      stop = true
    }
  }, [report, citations])

  if (error) {
    return (
      <p role="alert" className="rounded-lg border border-danger bg-danger-subtle p-4 text-sm">
        Chưa tải được kết quả: {error}
      </p>
    )
  }

  if (!report?.ready) {
    return (
      <section className="space-y-3">
        <p className="text-ink-muted">
          Đang đối chiếu CV với mô tả công việc…
        </p>
        <div className="h-24 animate-pulse rounded-lg bg-canvas" />
        <div className="h-40 animate-pulse rounded-lg bg-canvas" />
        {jobId && <p className="text-xs text-ink-subtle">Mã phiên: {jobId}</p>}
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
            <span className="ml-2 text-sm font-normal text-ink-muted">
              ({report.jd.seniority})
            </span>
          )}
        </h1>
      </header>

      {report.degraded && (
        <p
          role="status"
          className="rounded-lg border border-warn bg-warn-subtle p-3 text-sm"
        >
          {report.degradedReason ??
            'Đang dùng đối chiếu từ khoá. Phân tích ngữ nghĩa tạm không khả dụng.'}
        </p>
      )}

      {/* ── Điểm ─────────────────────────────────────────────────────── */}
      <section className="flex flex-wrap items-center gap-8 rounded-lg border border-border p-5">
        <div className="text-center">
          <div className="text-4xl font-bold tabular-nums">{report.overall}</div>
          <div className="text-xs text-ink-muted">/100</div>
        </div>
        <dl className="min-w-[240px] flex-1 space-y-1.5">
          {Object.entries(report.breakdown ?? {}).map(([k, v]) => (
            <div key={k} className="flex items-center gap-3 text-sm">
              <dt className="w-28 shrink-0 text-ink-muted">
                {LABEL[k] ?? k}
              </dt>
              <dd className="flex flex-1 items-center gap-2">
                <span
                  className="h-2 flex-1 overflow-hidden rounded-full bg-border"
                  aria-hidden
                >
                  <span
                    className="block h-full rounded-full bg-brand"
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
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-muted">
            Đã khớp ({report.matched!.length})
          </h2>
          <ul className="space-y-1.5">
            {report.matched!.map((m) => (
              <li key={m.requirement} className="flex flex-wrap items-baseline gap-2 text-sm">
                <span className="text-success">✓</span>
                <span className="font-medium">{m.requirement}</span>
                {m.evidence[0] && (
                  // Bằng chứng luôn hiện ra: user phải kiểm chứng được, và
                  // không có nó thì con số chỉ là lời khẳng định suông
                  <span className="text-ink-muted">
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
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-muted">
            Còn thiếu ({gaps.length})
            {(report.advicePending ?? 0) > 0 && (
              <span className="ml-2 font-normal normal-case text-ink-subtle">
                đang soạn lời khuyên cho {report.advicePending} mục…
              </span>
            )}
          </h2>
          <ul className="space-y-3">
            {gaps.map((g) => (
              <li
                key={g.id}
                className="rounded-lg border border-border p-3"
              >
                <div className="flex flex-wrap items-baseline gap-2 text-sm">
                  <span aria-hidden>{SEVERITY[g.severity]?.dot}</span>
                  <span className="font-medium">{g.requirement}</span>
                  <span className="text-xs text-ink-muted">{REASON[g.reason]}</span>
                  <Link
                    href={"/builder/" + cvId + "?assistant=1"}
                    className="ml-auto text-xs font-medium text-brand underline underline-offset-2 hover:text-brand-hover"
                  >
                    Sửa giúp tôi
                  </Link>
                </div>

                {g.advice ? (
                  <div className="mt-2">
                    <p className="text-sm text-ink">💬 {g.advice}</p>

                    {/*
                      §10.4 — ranh giới giữa "có nguồn" và "AI tự nghĩ" phải
                      KHÁC NHAU RÕ RỆT bằng mắt (TC-63-02). Nó vừa tạo niềm tin,
                      vừa là công cụ gỡ lỗi: lời khuyên sai thì biết ngay nó
                      đến từ đâu.
                    */}
                    {g.kbRefs.length > 0 ? (
                      <div className="mt-1.5 space-y-1">
                        {g.kbRefs.map((ref) => {
                          const c = citations[ref]
                          return (
                            <details key={ref} className="text-xs">
                              <summary className="cursor-pointer text-success">
                                📖 Theo {c?.authorName ?? '…'}
                                {c?.authorTitle ? ` — ${c.authorTitle}` : ''}
                              </summary>
                              <p className="mt-1 whitespace-pre-wrap border-l-2 border-success pl-2 text-ink-muted">
                                {c?.excerpt ?? 'Đang tải trích đoạn…'}
                              </p>
                            </details>
                          )
                        })}
                      </div>
                    ) : (
                      <p className="mt-1.5 inline-block rounded border border-dashed border-border-strong bg-canvas px-2 py-0.5 text-xs text-ink-muted">
                        ⚡ Gợi ý chung của AI — chưa dựa trên tri thức HR nào
                      </p>
                    )}
                  </div>
                ) : (
                  <div
                    className="mt-2 h-4 w-3/4 animate-pulse rounded bg-canvas"
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
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-muted">
            Từ khoá ATS còn thiếu ({report.missingAtsKeywords!.length})
          </h2>
          <p className="text-sm text-ink-muted">
            {report.missingAtsKeywords!.join(' · ')}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            Hệ thống lọc hồ sơ tự động quét đúng chuỗi trong tin tuyển dụng — nó không
            biết “ReactJS” và “React” là một.
          </p>
        </section>
      )}
    </div>
  )
}
