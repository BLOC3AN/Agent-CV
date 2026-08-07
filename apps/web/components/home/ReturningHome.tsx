'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { Completeness } from '@hr/matching'
import type { NextStep } from '@/lib/home-state'

/**
 * Home quay lại — bảng việc cần làm. UC-02, PRODUCT §6.
 *
 * Câu hỏi ở đây KHÁC Home lần đầu: không phải "bạn cần giúp gì" mà "bạn nên
 * làm gì tiếp". Hỏi lại người quay lại lần thứ năm rằng họ đã có CV chưa là
 * hỏi một câu mà hệ thống đã biết câu trả lời.
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
  // `jdId`/`when` phục vụ khử trùng lặp và mốc thời gian ở page.tsx — giao
  // diện hiển thị hai field này sẽ được dựng lại ở Task 12.
  jdId: string | null
  when: string
}

interface Props {
  greeting: string
  completeness: Completeness
  cv: RecentCv | null
  nextStep: NextStep | null
  matches: RecentMatch[]
}

export function ReturningHome({ greeting, completeness, cv, nextStep, matches }: Props) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold">{greeting}</h1>

      <CompletenessBar completeness={completeness} />

      {cv && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Tiếp tục chỗ đang dở
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-700">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{cv.title}</p>
              <p className="text-sm text-neutral-500">Sửa {cv.updatedAt}</p>
            </div>
            <Link
              href={`/builder/${cv.id}`}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700"
            >
              Tiếp tục
            </Link>
          </div>
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Việc nên làm tiếp
        </h2>
        {nextStep ? (
          <div className="mt-2 rounded-xl border border-neutral-200 p-4 dark:border-neutral-700">
            <p className="text-sm">{nextStep.text}</p>
            <Link
              href={nextStep.href}
              className="mt-3 inline-block rounded-lg border border-sky-600 px-4 py-2 text-sm font-medium text-sky-700 hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-sky-950/30"
            >
              {nextStep.cta}
            </Link>
          </div>
        ) : (
          /*
           * KHÔNG bịa việc để lấp chỗ trống (BR-02.3). Một việc bịa ra làm
           * người dùng mất tin vào mọi thứ phía trên nó.
           */
          <p className="mt-2 text-sm text-neutral-500">
            CV của bạn đang ổn — chưa có việc nào cần làm gấp.
          </p>
        )}
      </section>

      {matches.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Đối chiếu gần đây
          </h2>
          <ul className="mt-2 divide-y divide-neutral-200 rounded-xl border border-neutral-200 dark:divide-neutral-700 dark:border-neutral-700">
            {matches.map((m, i) => (
              <li key={i}>
                <Link
                  href={`/analyze/${m.cvId}`}
                  className="flex items-center justify-between px-4 py-3 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800"
                >
                  <span className="truncate">{m.jdTitle}</span>
                  <span className="ml-3 shrink-0 font-medium tabular-nums">{m.overall}%</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}

/**
 * Mức đầy đủ hồ sơ — BR-02.1.
 *
 * Bấm vào con số phải xem được nó gồm những gì. Đây là chỗ dễ bịa nhất trong
 * cả sản phẩm, và một con số bịa ở màn hình đầu tiên làm hỏng niềm tin vào mọi
 * thứ phía sau. Không phần trăm nào mà người dùng không tra được nguồn.
 */
function CompletenessBar({ completeness }: { completeness: Completeness }) {
  const [open, setOpen] = useState(false)

  return (
    <section className="mt-6">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full rounded-xl border border-neutral-200 p-4 text-left hover:border-neutral-400 dark:border-neutral-700"
      >
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-neutral-600 dark:text-neutral-300">
            Hồ sơ đã đầy đủ <strong className="tabular-nums">{completeness.percent}%</strong>
          </span>
          <span className="text-xs text-neutral-500">{open ? 'Ẩn chi tiết' : 'Gồm những gì?'}</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
          <div
            className="h-full rounded-full bg-sky-600 transition-all"
            style={{ width: `${completeness.percent}%` }}
          />
        </div>
      </button>

      {open && (
        <ul className="mt-2 space-y-1 rounded-xl border border-neutral-200 p-4 text-sm dark:border-neutral-700">
          {completeness.parts.map((p) => (
            <li key={p.key} className="flex items-baseline gap-2">
              <span aria-hidden className={p.done ? 'text-emerald-600' : 'text-neutral-400'}>
                {p.done ? '✓' : '○'}
              </span>
              <span className={p.done ? '' : 'text-neutral-600 dark:text-neutral-400'}>
                {p.label}
                <span className="ml-1 text-xs text-neutral-500">({p.weight}%)</span>
              </span>
              {!p.done && (
                <span className="ml-auto text-right text-xs text-neutral-500">{p.todo}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
