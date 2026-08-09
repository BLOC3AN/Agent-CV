'use client'

import { useState } from 'react'
import type { ClarifyRequest } from '@hr/schema'

/**
 * Form hỏi làm rõ — UC-52.
 *
 * BR-52.1: **AI không được tự sinh con số không do người dùng cung cấp.** Khi
 * cần số liệu, nó hỏi ở đây thay vì bịa.
 *
 * BR-52.2: tối đa 3 câu — hỏi nhiều gây bỏ cuộc.
 */

export interface ClarifyData {
  /** Câu hỏi ban đầu của user, gửi lại cùng câu trả lời */
  originalMessage: string
  request: ClarifyRequest
}

interface Props {
  data: ClarifyData
  onSubmit: (answers: { question: string; answer: string }[]) => void
  onSkip: () => void
}

function questionKey(q: ClarifyRequest['questions'][number], index: number): string {
  return `${index}:${q.id}`
}

export function ClarifyForm({ data, onSubmit, onSkip }: Props) {
  const [values, setValues] = useState<Record<string, string>>({})

  const answered = data.request.questions
    .map((q, i) => ({ question: q.question, answer: (values[questionKey(q, i)] ?? '').trim() }))
    .filter((a) => a.answer !== '')

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(answered)
      }}
      className="builder-clarify-form rounded-lg border border-brand-border bg-brand-subtle/60 p-3  "
    >
      <p className="text-sm text-ink ">{data.request.reason}</p>

      <div className="mt-3 space-y-2">
        {data.request.questions.map((q, i) => {
          const key = questionKey(q, i)
          return (
            <label key={key} className="block text-sm">
              <span className="text-ink ">{q.question}</span>
              <input
                type="text"
                value={values[key] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                placeholder={q.placeholder}
                className="mt-1 w-full rounded border border-border-strong px-2 py-1.5  "
              />
            </label>
          )
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={answered.length === 0}
          className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          Gửi
        </button>
        {/*
          UC-52 3a: "Không có số liệu" là lối thoát BẮT BUỘC. Nhiều sinh viên
          thật sự không đo được gì — ép họ điền sẽ dẫn tới bịa số, đúng thứ
          BR-52.1 muốn tránh.
        */}
        <button
          type="button"
          onClick={() => onSubmit([{ question: 'Có số liệu không?', answer: 'Không có số liệu cụ thể' }])}
          className="rounded border border-border-strong px-3 py-1.5 text-sm "
        >
          Tôi không có số liệu
        </button>
        <button
          type="button"
          onClick={onSkip}
          className="px-2 py-1.5 text-sm text-ink-muted underline underline-offset-2"
        >
          Bỏ qua
        </button>
      </div>
    </form>
  )
}
