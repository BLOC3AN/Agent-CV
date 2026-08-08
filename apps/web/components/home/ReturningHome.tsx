'use client'

import Link from 'next/link'
import type { Completeness } from '@hr/matching'
import type { Profile } from '@hr/schema'
import type { NextStep } from '@/lib/home-state'
import { Card, Section, Meter } from '@/components/ui'
import { CvThumbnail } from '@/components/cv/CvThumbnail'
import { AiPanel } from '@/components/ai/AiPanel'

/**
 * Home quay lại — bảng việc cần làm. UC-02, PRODUCT §6.
 *
 * Câu hỏi ở đây KHÁC Home lần đầu: không phải "bạn cần giúp gì" mà "bạn nên
 * làm gì tiếp". Hỏi lại người quay lại lần thứ năm rằng họ đã có CV chưa là
 * hỏi một câu mà hệ thống đã biết câu trả lời.
 *
 * ── Ba mức trọng số, không phải bốn khối bằng nhau ──
 * Bản trước có bốn khối cùng viền, cùng bo góc, cùng cỡ nhãn — mắt không có
 * điểm vào. Giờ: thẻ CV là CHÍNH (nền nổi, có thumbnail), gợi ý trợ lý là
 * THỨ HAI (nền teal), danh sách đối chiếu là PHỤ (dòng trần, không viền).
 */

export interface RecentCv {
  id: string
  title: string
  updatedAt: string
}

export interface RecentMatch {
  jdTitle: string
  overall: number
  cvId: string
  jdId: string | null
  /** Mốc tương đối: "hôm nay", "3 ngày trước" — thiếu nó thì hai lần đối
   *  chiếu cùng một JD trông giống hệt nhau */
  when: string
}

interface Props {
  greeting: string
  completeness: Completeness
  cv: RecentCv | null
  profile: Profile | null
  nextStep: NextStep | null
  matches: RecentMatch[]
  aiAvailable: boolean
}

export function ReturningHome({
  greeting,
  completeness,
  cv,
  profile,
  nextStep,
  matches,
  aiAvailable,
}: Props) {
  return (
    <main className="mx-auto max-w-7xl px-6 py-8 lg:px-10 lg:py-10">
      <header>
        <p className="text-[13px] font-medium text-brand-ink">Tổng quan</p>
        <h1 className="mt-1 text-[24px] font-semibold text-ink">{greeting}</h1>
        <p className="mt-1 text-[15px] text-ink-muted">
          Tiếp tục hoàn thiện hồ sơ từ nơi bạn đã dừng lại.
        </p>
      </header>

      <div className="mt-7 grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        {cv ? (
          <Card variant="raised" className="p-5 sm:p-6">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
              {profile && <CvThumbnail profile={profile} width={154} />}
              <div className="min-w-0 flex-1">
                <span className="inline-flex rounded-full bg-brand-subtle px-2.5 py-1 text-xs font-medium text-brand-ink">
                  CV đang chỉnh sửa
                </span>
                <p className="mt-3 truncate text-[22px] font-semibold text-ink">{cv.title}</p>
                <p className="mt-1 text-[15px] text-ink-muted">
                  {profile?.basics.headline ?? 'Hồ sơ nghề nghiệp'}
                </p>
                <p className="mt-2 text-[13px] text-ink-subtle">Sửa {cv.updatedAt}</p>

                <div className="mt-5 flex flex-wrap gap-2">
                  <Link
                    href={`/builder/${cv.id}`}
                    className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2.5 text-[15px] font-medium text-white transition-colors hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                  >
                    Tiếp tục chỉnh CV
                    <span aria-hidden="true">→</span>
                  </Link>
                  <Link
                    href="/cv"
                    className="inline-flex items-center rounded-md border border-border-strong bg-surface px-4 py-2.5 text-[15px] font-medium text-ink transition-colors hover:border-brand hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                  >
                    Tất cả CV
                  </Link>
                </div>
              </div>
            </div>
          </Card>
        ) : (
          <Card variant="raised" className="p-6">
            <p className="text-lg font-semibold text-ink">Tạo CV đầu tiên của bạn</p>
            <p className="mt-2 text-sm text-ink-muted">
              Bắt đầu bằng một file PDF hoặc nhập thông tin trực tiếp.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link href="/import" className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover">
                Tải CV lên
              </Link>
              <Link href="/cv/new" className="rounded-md border border-border-strong px-4 py-2 text-sm font-medium text-ink hover:border-brand hover:text-brand">
                Nhập tay
              </Link>
            </div>
          </Card>
        )}

        <CompletenessCard completeness={completeness} />

        <div className="lg:col-span-2">
          {nextStep ? (
            <AiPanel
              available={aiAvailable}
              actions={
                <Link
                  href={nextStep.href}
                  className="inline-flex items-center rounded-md bg-brand px-3 py-1.5 text-[13px] font-medium text-white hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  {nextStep.cta}
                </Link>
              }
            >
              {nextStep.text}
            </AiPanel>
          ) : (
            <p className="text-[13px] text-ink-muted">
              CV của bạn đang ổn — chưa có việc nào cần làm gấp.
            </p>
          )}
        </div>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <section>
          <Section
            title="Đối chiếu gần đây"
            action={
              <Link href="/cv" className="text-[12px] text-brand hover:text-brand-hover">
                Xem tất cả
              </Link>
            }
          >
            {matches.length > 0 ? (
              <ul className="grid gap-3 sm:grid-cols-2">
                {matches.map((m, i) => (
                  <li key={m.jdId ?? `x-${i}`}>
                    <Link
                      href={`/analyze/${m.cvId}`}
                      className="block rounded-lg border border-border bg-surface p-4 transition-colors hover:border-brand hover:shadow-sm"
                    >
                      <div className="flex items-start gap-3">
                        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-subtle font-semibold text-brand-ink">
                          {m.jdTitle.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-semibold text-ink">{m.jdTitle}</span>
                          <span className="mt-1 block text-xs text-ink-subtle">{m.when}</span>
                        </span>
                        <span className="shrink-0 text-lg font-semibold tabular-nums text-ink">{m.overall}</span>
                      </div>
                      <span className="mt-4 block text-xs font-medium text-brand">Xem phân tích chi tiết →</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-muted">Chưa có lần đối chiếu nào.</p>
            )}
          </Section>
        </section>

        <section>
          <Section title="Hành động nhanh">
            <div className="space-y-2">
              <QuickAction href="/cv/new" icon="＋" label="Tạo CV mới" />
              <QuickAction href="/import" icon="↑" label="Tải CV lên" />
            </div>
          </Section>
        </section>
      </div>
    </main>
  )
}

function CompletenessCard({ completeness }: { completeness: Completeness }) {
  const percent = Math.max(0, Math.min(100, Math.round(completeness.percent)))
  return (
    <Card variant="default" className="p-5 sm:p-6">
      <h2 className="text-[17px] font-semibold text-ink">Mức độ hoàn thiện hồ sơ</h2>
      <div className="mt-5 flex items-center gap-5">
        <div
          className="flex h-32 w-32 shrink-0 items-center justify-center rounded-full"
          style={{ background: `conic-gradient(var(--color-brand) ${percent}%, var(--color-border) 0)` }}
          aria-label={`${percent}% hoàn thiện`}
          role="img"
        >
          <div className="flex h-24 w-24 flex-col items-center justify-center rounded-full bg-surface">
            <strong className="text-3xl tabular-nums text-ink">{percent}%</strong>
            <span className="text-xs text-ink-muted">Hoàn thiện</span>
          </div>
        </div>
        <p className="min-w-0 text-sm text-ink-muted">
          Mở chi tiết để xem phần nào đã đủ và việc tiếp theo cần làm.
        </p>
      </div>
      <Meter
        className="mt-5"
        value={percent}
        label="Hồ sơ đã đầy đủ"
        parts={completeness.parts}
        showValue={false}
      />
    </Card>
  )
}

function QuickAction({ href, icon, label }: { href: string; icon: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-md border border-border px-3 py-2.5 text-sm text-ink transition-colors hover:border-brand hover:text-brand"
    >
      <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded bg-canvas text-base">
        {icon}
      </span>
      {label}
      <span aria-hidden="true" className="ml-auto text-ink-subtle">→</span>
    </Link>
  )
}
