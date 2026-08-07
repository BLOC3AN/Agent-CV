'use client'

import Link from 'next/link'
import type { CvHealth } from '@hr/matching'

/**
 * Bản chẩn đoán sức khoẻ CV — UC-04, PRODUCT §5.3.
 *
 * Người dùng hoang mang không cần một trình soạn thảo đẹp hơn. Họ cần hệ thống
 * nói: *"đây là 3 thứ nên sửa trước"*. Đó là toàn bộ lý do màn hình này tồn tại.
 *
 * Giọng của màn này quyết định người dùng ở lại hay bỏ đi: cùng một sự thật,
 * "CV của bạn yếu" và "đây là 3 thứ sửa xong sẽ khác hẳn" cho hai kết cục.
 */

const VERDICT: Record<string, { text: string; bar: string; dot: string }> = {
  good: { text: 'Tốt', bar: 'bg-emerald-500', dot: 'text-emerald-600' },
  ok: { text: 'Tạm được', bar: 'bg-amber-500', dot: 'text-amber-600' },
  weak: { text: 'Cần sửa', bar: 'bg-red-500', dot: 'text-red-600' },
}

interface Props {
  health: CvHealth
  cvId: string
}

export function HealthReport({ health, cvId }: Props) {
  if (!health.scored) {
    // Nói thẳng chưa chấm được, KHÔNG hiện thanh rỗng giả vờ đã đo (BR-P.4)
    return (
      <div className="rounded-xl border border-neutral-200 p-6 dark:border-neutral-700">
        <p className="font-medium">Chưa chấm được CV này</p>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Chưa có bộ tiêu chí nào phù hợp với ngành và cấp bậc của bạn. Bạn vẫn
          mở trình soạn và nhờ trợ lý xem giúp được.
        </p>
        <Link
          href={`/builder/${cvId}`}
          className="mt-4 inline-block rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white"
        >
          Mở trình soạn
        </Link>
      </div>
    )
  }

  return (
    <>
      {/* Điểm MẠNH trước — BR-04.4 */}
      {health.strengths.length > 0 && (
        <section className="rounded-xl border border-emerald-300 bg-emerald-50/60 p-4 dark:border-emerald-800 dark:bg-emerald-950/20">
          <h2 className="text-sm font-semibold">CV của bạn đang làm tốt</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {health.strengths.map((s) => (
              <li key={s.id}>
                <span aria-hidden className="text-emerald-600">
                  ✓{' '}
                </span>
                {s.label} — {s.actual}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Sức khoẻ CV
        </h2>
        <ul className="mt-3 space-y-3">
          {health.bars.map((b) => {
            const v = VERDICT[b.verdict]!
            return (
              <li key={b.id}>
                <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <span className="flex-1">{b.label}</span>
                  <span className={`text-xs font-medium ${v.dot}`}>{v.text}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
                  <div className={`h-full rounded-full ${v.bar}`} style={{ width: `${b.score}%` }} />
                </div>
                {/* Nói ĐO ĐƯỢC GÌ — để người dùng hiểu vì sao bị trừ */}
                <p className="mt-1 text-xs text-neutral-500">
                  {b.actual} · cần {b.expected}
                </p>
              </li>
            )
          })}
        </ul>
      </section>

      {health.fixes.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
            {health.fixes.length} thứ nên sửa trước
          </h2>
          <ol className="mt-3 space-y-3">
            {health.fixes.map((f, i) => (
              <li
                key={f.id}
                className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-700"
              >
                <div className="flex gap-3">
                  <span className="shrink-0 font-semibold text-neutral-400">{i + 1}</span>
                  <div className="min-w-0">
                    <p className="text-sm">{f.advice}</p>
                    {/* Bấm vào là TỚI ĐÚNG CHỖ — BR-04.2 */}
                    <Link
                      href={`/builder/${cvId}?focus=${encodeURIComponent(f.path)}`}
                      className="mt-2 inline-block text-sm text-sky-700 underline underline-offset-2 dark:text-sky-400"
                    >
                      Sửa mục {f.section}
                    </Link>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <p className="mt-8 rounded-xl border border-neutral-200 p-4 text-sm dark:border-neutral-700">
          Không có tiêu chí nào đang dưới ngưỡng. CV của bạn đang ở trạng thái tốt.
        </p>
      )}

      {health.manual.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Cần người đọc mới đánh giá được
          </h2>
          {/* Tách riêng, KHÔNG trộn vào điểm — chấm bừa còn tệ hơn bỏ qua */}
          <ul className="mt-2 space-y-1 text-sm text-neutral-600 dark:text-neutral-400">
            {health.manual.map((m) => (
              <li key={m.id}>· {m.label.vi}</li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href={`/builder/${cvId}?chat=1`}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700"
        >
          Sửa cùng trợ lý
        </Link>
        <Link
          href={`/builder/${cvId}`}
          className="rounded-lg border border-neutral-300 px-4 py-2 text-sm dark:border-neutral-600"
        >
          Mở trình soạn
        </Link>
      </div>
    </>
  )
}
