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
  good: { text: 'Tốt', bar: 'bg-success', dot: 'text-success' },
  ok: { text: 'Tạm được', bar: 'bg-warn', dot: 'text-warn' },
  weak: { text: 'Cần sửa', bar: 'bg-danger', dot: 'text-danger' },
}

interface Props {
  health: CvHealth
  cvId: string
}

export function HealthReport({ health, cvId }: Props) {
  if (!health.scored) {
    // Nói thẳng chưa chấm được, KHÔNG hiện thanh rỗng giả vờ đã đo (BR-P.4)
    return (
      <div className="rounded-xl border border-border p-6 ">
        <p className="font-medium">Chưa chấm được CV này</p>
        <p className="mt-1 text-sm text-ink-muted ">
          Chưa có bộ tiêu chí nào phù hợp với ngành và cấp bậc của bạn. Bạn vẫn
          mở trình soạn và nhờ trợ lý xem giúp được.
        </p>
        <Link
          href={`/builder/${cvId}`}
          className="mt-4 inline-block rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white"
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
        <section className="rounded-xl border border-success bg-success-subtle p-4  ">
          <h2 className="text-sm font-semibold">CV của bạn đang làm tốt</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {health.strengths.map((s) => (
              <li key={s.id}>
                <span aria-hidden className="text-success">
                  ✓{' '}
                </span>
                {s.label} — {s.actual}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
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
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-canvas ">
                  <div className={`h-full rounded-full ${v.bar}`} style={{ width: `${b.score}%` }} />
                </div>
                {/* Nói ĐO ĐƯỢC GÌ — để người dùng hiểu vì sao bị trừ */}
                <p className="mt-1 text-xs text-ink-muted">
                  {b.actual} · cần {b.expected}
                </p>
              </li>
            )
          })}
        </ul>
      </section>

      {health.fixes.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
            {health.fixes.length} thứ nên sửa trước
          </h2>
          <ol className="mt-3 space-y-3">
            {health.fixes.map((f, i) => (
              <li
                key={f.id}
                className="rounded-xl border border-border p-4 "
              >
                <div className="flex gap-3">
                  <span className="shrink-0 font-semibold text-ink-subtle">{i + 1}</span>
                  <div className="min-w-0">
                    <p className="text-sm">{f.advice}</p>
                    {/* Bấm vào là TỚI ĐÚNG CHỖ — BR-04.2 */}
                    <Link
                      href={`/builder/${cvId}?focus=${encodeURIComponent(f.path)}`}
                      className="mt-2 inline-block text-sm text-brand-ink underline underline-offset-2 "
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
        <p className="mt-8 rounded-xl border border-border p-4 text-sm ">
          Không có tiêu chí nào đang dưới ngưỡng. CV của bạn đang ở trạng thái tốt.
        </p>
      )}

      {health.manual.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
            Cần người đọc mới đánh giá được
          </h2>
          {/* Tách riêng, KHÔNG trộn vào điểm — chấm bừa còn tệ hơn bỏ qua */}
          <ul className="mt-2 space-y-1 text-sm text-ink-muted ">
            {health.manual.map((m) => (
              <li key={m.id}>· {m.label.vi}</li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href={`/builder/${cvId}?chat=1`}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand"
        >
          Sửa cùng trợ lý
        </Link>
        <Link
          href={`/builder/${cvId}`}
          className="rounded-lg border border-border-strong px-4 py-2 text-sm "
        >
          Mở trình soạn
        </Link>
      </div>
    </>
  )
}
