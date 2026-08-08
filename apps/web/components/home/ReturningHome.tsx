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
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-[24px] font-semibold text-ink">{greeting}</h1>

      {cv && (
        <Card variant="raised" className="mt-6 p-5">
          <div className="flex flex-wrap items-start gap-5">
            {profile && <CvThumbnail profile={profile} width={132} />}

            <div className="min-w-0 flex-1">
              <p className="truncate text-[18px] font-semibold text-ink">{cv.title}</p>
              <p className="mt-0.5 text-[13px] text-ink-subtle">Sửa {cv.updatedAt}</p>

              <Meter
                className="mt-4"
                value={completeness.percent}
                label="Hồ sơ đã đầy đủ"
                parts={completeness.parts}
              />

              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href={`/builder/${cv.id}`}
                  className="inline-flex items-center rounded-md bg-brand px-4 py-2 text-[15px] font-medium text-white transition-colors hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  Tiếp tục chỉnh CV
                </Link>
                {/*
                  KHÔNG có nút "Xem CV" ở đây — BR-01.3 cấm hiện link tới màn
                  hình chưa tồn tại. Bản thiết kế vẽ nó, nhưng route `/cv/:id`
                  (xem CV ở chế độ chỉ đọc) chưa được dựng; chỉ có `/cv` và
                  `/cv/new`. Một nút 404 tệ hơn một nút vắng mặt: người dùng
                  bấm rồi kết luận sản phẩm hỏng.
                */}
                <Link
                  href="/cv"
                  className="inline-flex items-center rounded-md border border-border-strong bg-surface px-4 py-2 text-[15px] font-medium text-ink transition-colors hover:border-brand hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  Tất cả CV
                </Link>
              </div>
            </div>
          </div>
        </Card>
      )}

      <div className="mt-6">
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
          /*
           * KHÔNG bịa việc để lấp chỗ trống (BR-02.3). Một việc bịa ra làm
           * người dùng mất tin vào mọi thứ phía trên nó.
           */
          <p className="text-[13px] text-ink-muted">
            CV của bạn đang ổn — chưa có việc nào cần làm gấp.
          </p>
        )}
      </div>

      {matches.length > 0 && (
        <Section
          title="Đối chiếu gần đây"
          action={
            <Link href="/cv" className="text-[12px] text-brand hover:text-brand-hover">
              Xem tất cả
            </Link>
          }
        >
          <ul className="divide-y divide-border">
            {matches.map((m, i) => (
              <li key={m.jdId ?? `x-${i}`}>
                <Link
                  href={`/analyze/${m.cvId}`}
                  className="flex items-center gap-3 py-3 text-[15px] hover:text-brand"
                >
                  <span className="min-w-0 flex-1 truncate text-ink">{m.jdTitle}</span>
                  <span className="shrink-0 text-[12px] text-ink-subtle">{m.when}</span>
                  {/*
                   * KHÔNG tô màu con số — TDD §8.2.3: đo thực tế cho 41 và 41
                   * là ĐÚNG; thứ có nghĩa là thứ tự tương đối, không phải vạch
                   * ngưỡng. Tô đỏ 44% là đưa ra một phán quyết mà hệ thống
                   * chưa đủ cơ sở.
                   */}
                  <span className="w-8 shrink-0 text-right font-medium tabular-nums text-ink">
                    {m.overall}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </main>
  )
}
