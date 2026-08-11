import React, { useEffect, useRef, useState } from 'react'
import { useLocale } from '../lib/i18n'
import { errorMessageKey, stepText } from '../lib/error-messages'
import { Bot, Check, ChevronDown, Mic, Send, Sparkles, X, Zap } from 'lucide-react'
import type { CV, CVLayout } from '../types'
import { applyChatOpsToDraft } from '../lib/cv-patch'
import { sendChat, settleChatProposal, type ChatOp, type ClarifyRequest } from '../lib/api'

interface Props {
  profileId: string
  cvId: string
  cv: CV
  layout?: CVLayout
  draftVersion?: number
  onApplyAIProposal: (ops: ChatOp[], summary: string) => void
  onClose?: () => void
}

type ModelRef = 'local.reasoner' | 'deepseek.v4' | 'openai.luna'

const models: { ref: ModelRef; label: string }[] = [
  { ref: 'local.reasoner', label: 'Neura Flash' },
  { ref: 'deepseek.v4', label: 'Neura Plus' },
  { ref: 'openai.luna', label: 'Neura Pro' },
]

/*
 * Giữ dạng KHOÁ chứ không phải chữ đã dịch: danh sách này ở tầng module, chạy
 * một lần lúc nạp file, nên nhúng chữ vào đây sẽ đóng băng ngôn ngữ của lần
 * nạp đầu tiên và không đổi khi người dùng chuyển ngôn ngữ.
 */
const QUICK_ACTION_KEYS = [
  'optimiseExperience',
  'shortenSummary',
  'fixSpelling',
  'rewriteSkills',
  'createSummary',
  'suggestImprove',
] as const

function readAt(root: unknown, pointer: string): unknown {
  let node = root
  for (const part of pointer.split('/').slice(1)) {
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~')
    if (node === null || typeof node !== 'object') return undefined
    node = Array.isArray(node) ? node[Number(key)] : (node as Record<string, unknown>)[key]
  }
  return node
}

function display(value: unknown): string {
  if (value === undefined) return '—'
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

export function ChatPanel({ profileId, cvId, cv, layout, draftVersion, onApplyAIProposal, onClose }: Props) {
  const { t, locale } = useLocale()
  const effectiveLayout = layout ?? cv.layout ?? { version: 1 as const, nodes: [] }
  const effectiveDraftVersion = draftVersion ?? 0
  const currentDraftRef = useRef({ cv, layout: effectiveLayout, draftVersion: effectiveDraftVersion })
  currentDraftRef.current = { cv, layout: effectiveLayout, draftVersion: effectiveDraftVersion }
  const [modelRef, setModelRef] = useState<ModelRef>('local.reasoner')
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; text: string }[]>([])
  const [input, setInput] = useState('')
  const [step, setStep] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [clarify, setClarify] = useState<{ original: string; request: ClarifyRequest }>()
  const [proposal, setProposal] = useState<{ id: string; summary: string; ops: ChatOp[]; rejected: { path: string; reason: string }[]; draftVersion: number; settledOps?: ChatOp[] }>()
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [checked, setChecked] = useState<number[]>([])
  const controller = useRef<AbortController | undefined>(undefined)

  useEffect(() => () => controller.current?.abort(), [])

  async function send(text: string, suppliedAnswers: { question: string; answer: string }[] = []) {
    if (!text.trim() || busy) return
    const ac = new AbortController()
    controller.current = ac
    setBusy(true)
    setError(undefined)
    setStep(undefined)
    setClarify(undefined)
    setMessages((m) => [...m, { role: 'user', text }])
    const requestDraftVersion = effectiveDraftVersion
    try {
      const result = await sendChat(profileId, text, suppliedAnswers, modelRef, undefined, ac.signal, setStep, { cvId, draft: cv, layout: effectiveLayout, draftVersion: requestDraftVersion }, locale)
      if (result.kind === 'reply') setMessages((m) => [...m, { role: 'assistant', text: result.text }])
      else if (result.kind === 'clarify') {
        setMessages((m) => [...m, { role: 'assistant', text: result.request.reason }])
        setClarify({ original: text, request: result.request })
        setAnswers({})
      } else if (result.kind === 'patch') {
        setMessages((m) => [...m, { role: 'assistant', text: result.summary }])
        setProposal({ id: result.proposalId, summary: result.summary, ops: result.ops, rejected: result.rejected, draftVersion: requestDraftVersion })
        setChecked(result.ops.map((op, i) => op.grounding.type === 'inference' ? -1 : i).filter((i) => i >= 0))
      } else {
        // Dịch theo MÃ; `message` của máy chủ chỉ là chỗ lùi cho mã chưa biết.
        // Giữ `requestId` vì đó là thứ duy nhất tra được log khi người dùng báo lỗi.
        const key = errorMessageKey(result.code)
        const text = key ? t(key) : result.message
        setError(`${text}${result.requestId ? ` (requestId: ${result.requestId})` : ''}`)
      }
    } catch (err) {
      if (!ac.signal.aborted) setError(err instanceof Error ? err.message : t('sendFailed'))
    } finally {
      if (!ac.signal.aborted) { setBusy(false); setStep(undefined) }
    }
  }

  async function applyProposal(accept: number[]) {
    if (!proposal) return
    setBusy(true)
    setError(undefined)
    try {
      const selectedOps = proposal.settledOps ?? proposal.ops.filter((_, index) => accept.includes(index))
      // Preflight against the current local draft before settling. This keeps
      // a dirty draft safe even if the user edited it while the proposal was open.
      applyChatOpsToDraft({ cv, layout: effectiveLayout }, selectedOps)
      const result = proposal.settledOps
        ? { selectedOps: proposal.settledOps, applied: proposal.settledOps.length }
        : await settleChatProposal(proposal.id, profileId, { cvId, draftVersion: proposal.draftVersion }, accept)
      if (!proposal.settledOps && currentDraftRef.current.draftVersion !== proposal.draftVersion) {
        setProposal({ ...proposal, settledOps: result.selectedOps })
        throw new Error(t('draftChangedDuringSettle'))
      }
      if (result.selectedOps.length) {
        try {
          onApplyAIProposal(result.selectedOps, proposal.summary)
        } catch (err) {
          setProposal({ ...proposal, settledOps: result.selectedOps })
          throw err
        }
      }
      setProposal(undefined)
      setMessages((m) => [...m, { role: 'assistant', text: result.selectedOps.length ? t('appliedToDraft', { n: result.applied }) : t('proposalSkipped') }])
    } catch (err) {
      setError(err instanceof Error ? err.message : t('applyFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label={t('assistantTitle')} className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-xl">
      <header className="flex shrink-0 items-center justify-between bg-[#10132d] px-4 py-4 text-white">
        <div className="flex items-center gap-2">
          <Bot aria-hidden="true" className="h-5 w-5 text-violet-400" />
          <h2 className="text-sm font-bold">{t('assistantTitle')}</h2>
        </div>
        <button type="button" aria-label={t('closeAssistant')} onClick={onClose} className="rounded-lg p-1 text-slate-400 transition hover:bg-white/10 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="shrink-0 space-y-3 border-b border-slate-200 bg-slate-50 px-3.5 py-3.5">
        <div>
          <label htmlFor="ai-model" className="mb-1 block text-[10px] font-semibold tracking-wider text-slate-500">{t('aiModel')}</label>
          <div className="relative">
            <select id="ai-model" aria-label={t('aiModel')} value={modelRef} onChange={(e) => setModelRef(e.target.value as ModelRef)} className="w-full appearance-none rounded-xl border border-violet-600 bg-white px-3 py-2 text-xs font-medium text-slate-800 outline-none focus:ring-2 focus:ring-violet-200">
              {models.map((model) => <option key={model.ref} value={model.ref}>{model.label}</option>)}
            </select>
            <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2.5 top-2 h-4 w-4 text-slate-400" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {QUICK_ACTION_KEYS.map((key) => (
            <button key={key} type="button" disabled={busy} onClick={() => void send(t(key))} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[10px] font-semibold text-slate-700 transition hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 disabled:opacity-50">
              {t(key)}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50 px-4 py-4 text-xs">
        {!messages.length && <p className="text-slate-500">{t('pickSuggestion')}</p>}
        {messages.map((message, i) => (
          <div key={`${message.role}-${i}`} className={`flex flex-col gap-1 ${message.role === 'user' ? 'items-end' : 'items-start'}`}>
            <div className={message.role === 'user' ? 'max-w-[90%] rounded-2xl rounded-br-md bg-violet-600 px-3 py-3 leading-relaxed text-white shadow-sm' : 'max-w-[95%] rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3 py-3 leading-relaxed text-slate-700 shadow-sm'}>
              {message.role === 'assistant' && <div className="mb-2 flex w-fit items-center gap-1 rounded border border-violet-100 bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-violet-700"><Sparkles className="h-3 w-3" />{t('aiSuggestion')}</div>}
              <span className="whitespace-pre-line">{message.text}</span>
            </div>
            <span className="px-1 text-[10px] text-slate-400">{t('justNow')}</span>
          </div>
        ))}
        {busy && <p role="status" className="animate-pulse rounded-xl border border-violet-100 bg-violet-50 p-3 font-medium text-violet-700">{stepText(step, t) ?? t('aiAnalysing')}…</p>}
        {clarify && <form onSubmit={(e) => { e.preventDefault(); void send(clarify.original, clarify.request.questions.map((q) => ({ question: q.question, answer: answers[q.id] ?? '' })).filter((a) => a.answer.trim())) }} className="space-y-2 rounded-xl border border-violet-200 bg-violet-50 p-3"><p className="font-medium">{clarify.request.reason}</p>{clarify.request.questions.map((q) => <label key={q.id} className="block">{q.question}<input value={answers[q.id] ?? ''} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} placeholder={q.placeholder} className="mt-1 w-full rounded border px-2 py-1" /></label>)}<button disabled={busy || !Object.values(answers).some(Boolean)} className="rounded bg-violet-600 px-3 py-1.5 text-white">{t('sendAnswers')}</button><button type="button" onClick={() => void send(clarify.original, [{ question: t('hasFiguresQuestion'), answer: t('noFigures') }])} className="ml-2 underline">{t('noFiguresAction')}</button></form>}
        {proposal && <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3 text-slate-700 shadow-sm"><div className="flex w-fit items-center gap-1 rounded border border-violet-100 bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-violet-700"><Sparkles className="h-3 w-3" />{t('aiSuggestion')}</div><p className="font-medium">{proposal.summary}</p>{proposal.ops.map((op, i) => <label key={`${op.path}-${i}`} className="flex gap-2"><input type="checkbox" checked={checked.includes(i)} onChange={() => setChecked((c) => c.includes(i) ? c.filter((x) => x !== i) : [...c, i])} /><span><code>{op.path}</code>{op.op !== 'add' && <><br /><del>{display(readAt(cv, op.path))}</del> → </>}{display(op.value)}</span></label>)}<div className="mt-3 border-t border-slate-100 pt-2"><button disabled={busy || !checked.length} onClick={() => void applyProposal(checked)} className="flex w-full items-center justify-center gap-1 rounded-lg bg-violet-600 py-2 text-xs font-semibold text-white transition hover:bg-violet-700 disabled:opacity-50"><Zap className="h-3.5 w-3.5" />{t('applyToCV')}</button><button disabled={busy} onClick={() => void applyProposal([])} className="mt-2 w-full text-xs text-slate-500 underline">{t('skip')}</button></div></div>}
        {error && <p role="alert" className="rounded bg-rose-50 p-2 text-rose-700">{error}</p>}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); const value = input; setInput(''); void send(value) }} className="shrink-0 border-t border-slate-200 bg-white p-3">
        <div className="relative flex items-center">
          <input aria-label={t('messageToAssistant')} value={input} onChange={(e) => setInput(e.target.value)} disabled={busy} className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-3 pr-20 text-xs font-medium text-slate-800 outline-none placeholder:text-slate-400 focus:border-violet-500" placeholder={t('askAIPlaceholder')} />
          <div className="absolute right-1.5 flex items-center gap-1"><button type="button" aria-label={t('voiceInput')} className="rounded-lg p-1 text-slate-400 hover:text-slate-600"><Mic className="h-3.5 w-3.5" /></button><button aria-label={t('sendRequest')} disabled={busy || !input.trim()} className="rounded-lg bg-violet-600 p-1.5 text-white transition hover:bg-violet-700 disabled:bg-slate-200 disabled:text-slate-400"><Send className="h-3.5 w-3.5" /></button></div>
        </div>
      </form>
    </section>
  )
}
