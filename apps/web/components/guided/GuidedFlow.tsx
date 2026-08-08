'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  SITUATION_LABEL,
  bodyPrompt,
  nextStage,
  previousStage,
  type GuidedAnswers,
  type Situation,
  type StageId,
} from '@/lib/guided'

/**
 * Làm CV từ đầu, có người dẫn — UC-05.
 *
 * Một cụm mỗi bước, luôn có nút quay lại (BR-05.1). Người chưa từng viết CV
 * nhìn thấy một form 30 ô sẽ đóng tab; nhìn thấy mục "Kinh nghiệm" trống trơn
 * sẽ kết luận mình không đủ tư cách.
 */

const TOTAL = 5

export function GuidedFlow() {
  const router = useRouter()
  const [answers, setAnswers] = useState<GuidedAnswers>({})
  const [stage, setStage] = useState<StageId>('situation')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (patch: Partial<GuidedAnswers>) => setAnswers((a) => ({ ...a, ...patch }))

  const advance = (patch: Partial<GuidedAnswers>) => {
    const next = { ...answers, ...patch }
    setAnswers(next)
    const s = nextStage(next)
    if (s) setStage(s)
    else void finish(next)
  }

  const finish = async (a: GuidedAnswers) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/cv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: a.name,
          headline: a.target,
          email: a.email ?? '',
          guided: a,
        }),
      })
      const data = (await res.json()) as { cvId?: string; error?: string }
      if (!res.ok || !data.cvId) throw new Error(data.error ?? `HTTP ${res.status}`)
      router.push(`/builder/${data.cvId}`)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  const back = previousStage(stage)
  const stepNo = ['situation', 'target', 'experience', 'body', 'contact'].indexOf(stage) + 1
  const body = bodyPrompt(answers)

  return (
    <div>
      {/* Cho người dùng thấy còn bao xa — không thì họ không biết sắp xong chưa */}
      <p className="text-xs text-ink-muted">
        Bước {stepNo}/{TOTAL}
      </p>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-canvas ">
        <div className="h-full bg-brand transition-all" style={{ width: `${(stepNo / TOTAL) * 100}%` }} />
      </div>

      <div className="mt-6">
        {stage === 'situation' && (
          <Step title="Bạn đang ở đâu?" lead="Mình hỏi để biết nên tập trung vào phần nào của CV.">
            <div className="grid gap-2 sm:grid-cols-2">
              {(Object.keys(SITUATION_LABEL) as Situation[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => advance({ situation: s })}
                  className="rounded-lg border border-border-strong px-4 py-3 text-left text-sm hover:border-brand-border "
                >
                  {SITUATION_LABEL[s]}
                </button>
              ))}
            </div>
          </Step>
        )}

        {stage === 'target' && (
          <Step title="Bạn nhắm vị trí nào?" lead="Có đích cụ thể thì CV bám sát được, thay vì chung chung.">
            <TextStep
              placeholder="Ví dụ: Computer Vision Engineer"
              value={answers.target ?? ''}
              onChange={(v) => set({ target: v })}
              onSubmit={(v) => advance({ target: v })}
            />
          </Step>
        )}

        {stage === 'experience' && (
          <Step title="Bạn đã đi làm ở đâu chưa?" lead="Kể cả thực tập hay làm thêm đúng ngành cũng tính.">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => advance({ hasWorked: true })}
                className="rounded-lg border border-border-strong px-5 py-2.5 text-sm "
              >
                Rồi
              </button>
              <button
                type="button"
                onClick={() => advance({ hasWorked: false })}
                className="rounded-lg border border-border-strong px-5 py-2.5 text-sm "
              >
                Chưa
              </button>
            </div>
          </Step>
        )}

        {stage === 'body' && (
          /* Đây là chỗ ĐỔI HƯỚNG — BR-05.2. Lời dẫn đổi theo câu trả lời trước. */
          <Step title={body.title} lead={body.lead}>
            <div className="space-y-3">
              <Labeled label={body.labelTitle}>
                <input
                  value={answers.bodyTitle ?? ''}
                  onChange={(e) => set({ bodyTitle: e.target.value })}
                  aria-label={body.labelTitle}
                  className={INPUT}
                />
              </Labeled>
              <Labeled label={body.labelOrg}>
                <input
                  value={answers.bodyOrg ?? ''}
                  onChange={(e) => set({ bodyOrg: e.target.value })}
                  aria-label={body.labelOrg}
                  className={INPUT}
                />
              </Labeled>
              <Labeled label={body.labelHighlight}>
                <textarea
                  rows={3}
                  value={answers.bodyHighlight ?? ''}
                  onChange={(e) => set({ bodyHighlight: e.target.value })}
                  aria-label={body.labelHighlight}
                  className={INPUT}
                />
              </Labeled>
              <button
                type="button"
                disabled={!answers.bodyTitle?.trim()}
                onClick={() => advance({})}
                className="rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                Tiếp
              </button>
            </div>
          </Step>
        )}

        {stage === 'contact' && (
          <Step title="Cuối cùng, bạn tên gì?" lead="Nhà tuyển dụng cần biết liên hệ với ai.">
            <div className="space-y-3">
              <Labeled label="Họ và tên">
                <input
                  value={answers.name ?? ''}
                  onChange={(e) => set({ name: e.target.value })}
                  aria-label="Họ và tên"
                  className={INPUT}
                />
              </Labeled>
              <Labeled label="Email">
                <input
                  type="email"
                  value={answers.email ?? ''}
                  onChange={(e) => set({ email: e.target.value })}
                  aria-label="Email"
                  className={INPUT}
                />
              </Labeled>
              <button
                type="button"
                disabled={busy || !answers.name?.trim()}
                onClick={() => advance({})}
                className="rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                {busy ? 'Đang tạo CV…' : 'Tạo CV của tôi'}
              </button>
            </div>
          </Step>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-4 text-sm text-danger ">
          {error}
        </p>
      )}

      {back && !busy && (
        <button
          type="button"
          onClick={() => setStage(back)}
          className="mt-6 text-sm text-ink-muted underline"
        >
          Quay lại
        </button>
      )}
    </div>
  )
}

const INPUT =
  'mt-1 w-full rounded border border-border-strong px-3 py-2 text-sm  '

function Step({ title, lead, children }: { title: string; lead: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-ink-muted ">{lead}</p>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      {label}
      {children}
    </label>
  )
}

function TextStep({
  placeholder,
  value,
  onChange,
  onSubmit,
}: {
  placeholder: string
  value: string
  onChange: (v: string) => void
  onSubmit: (v: string) => void
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (value.trim()) onSubmit(value)
      }}
      className="flex gap-2"
    >
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="flex-1 rounded border border-border-strong px-3 py-2 text-sm  "
      />
      <button
        type="submit"
        disabled={!value.trim()}
        className="rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white disabled:opacity-40"
      >
        Tiếp
      </button>
    </form>
  )
}
