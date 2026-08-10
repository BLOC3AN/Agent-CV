import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { CV } from '../types'
import { saveCV, sendChat, settleChatProposal, type ChatOp, type ClarifyRequest } from '../lib/api'

interface Props {
  profileId: string
  cvId: string
  cv: CV
  onApplied: () => void
}

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
  if (value === undefined) return '(trống)'
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

export function ChatPanel({ profileId, cvId, cv, onApplied }: Props) {
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; text: string }[]>([])
  const [input, setInput] = useState('')
  const [step, setStep] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [clarify, setClarify] = useState<{ original: string; request: ClarifyRequest }>()
  const [proposal, setProposal] = useState<{ id: string; summary: string; ops: ChatOp[]; rejected: { path: string; reason: string }[] }>()
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [checked, setChecked] = useState<number[]>([])
  const controller = useRef<AbortController | undefined>(undefined)

  const suggestions = useMemo(() => {
    const out: string[] = []
    if (cv.sections.experience.length) out.push('Làm gọn mục kinh nghiệm')
    if (cv.sections.projects.length) out.push('Thêm số liệu cho dự án đầu tiên')
    if (cv.sections.intro.summary) out.push('Viết lại phần giới thiệu cho gọn hơn')
    return out.length ? out : ['CV của tôi còn thiếu gì?']
  }, [cv])

  useEffect(() => () => controller.current?.abort(), [])

  async function send(text: string, suppliedAnswers: { question: string; answer: string }[] = []) {
    if (!text.trim() || busy) return
    const ac = new AbortController()
    controller.current = ac
    setBusy(true); setError(undefined); setStep('Đang chuẩn bị'); setClarify(undefined)
    setMessages((m) => [...m, { role: 'user', text }])
    try {
      const result = await sendChat(profileId, text, suppliedAnswers, 'local.reasoner', undefined, ac.signal, setStep)
      if (result.kind === 'reply') setMessages((m) => [...m, { role: 'assistant', text: result.text }])
      else if (result.kind === 'clarify') {
        setMessages((m) => [...m, { role: 'assistant', text: result.request.reason }])
        setClarify({ original: text, request: result.request })
        setAnswers({})
      } else if (result.kind === 'patch') {
        setMessages((m) => [...m, { role: 'assistant', text: result.summary }])
        setProposal({ id: result.proposalId, summary: result.summary, ops: result.ops, rejected: result.rejected })
        setChecked(result.ops.map((op, i) => op.grounding.type === 'inference' ? -1 : i).filter((i) => i >= 0))
      } else {
        setError(`${result.message}${result.requestId ? ` (requestId: ${result.requestId})` : ''}`)
      }
    } catch (err) {
      if (!ac.signal.aborted) setError(err instanceof Error ? err.message : 'Không gửi được tin nhắn')
    } finally {
      if (!ac.signal.aborted) { setBusy(false); setStep(undefined) }
    }
  }

  async function applyProposal(accept: number[]) {
    if (!proposal) return
    setBusy(true); setError(undefined)
    try {
      const result = await settleChatProposal(proposal.id, profileId, accept)
      if (accept.length && result.profile) await saveCV(cvId, result.profile as CV)
      setProposal(undefined)
      setMessages((m) => [...m, { role: 'assistant', text: accept.length ? `Đã áp dụng ${result.applied} thay đổi.` : 'Đã bỏ qua đề xuất.' }])
      if (accept.length) onApplied()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không áp dụng được đề xuất')
    } finally { setBusy(false) }
  }

  return (
    <section aria-label="Trợ lý CV" className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-xl">
      <h2 className="text-sm font-bold text-slate-900">Trợ lý CV</h2>
      <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto text-xs">
        {!messages.length && <div className="space-y-1 text-slate-500"><p>Bạn muốn sửa gì trong CV?</p>{suggestions.map((s) => <button key={s} onClick={() => void send(s)} className="block text-left text-indigo-700 underline">{s}</button>)}</div>}
        {messages.map((m, i) => <div key={i} className={`rounded-xl px-3 py-2 ${m.role === 'user' ? 'ml-6 bg-indigo-600 text-white' : 'mr-4 bg-slate-100 text-slate-800'}`}>{m.text}</div>)}
        {busy && <p role="status" className="text-slate-500">{step ?? 'Đang xử lý'}…</p>}
        {clarify && <form onSubmit={(e) => { e.preventDefault(); void send(clarify.original, clarify.request.questions.map((q) => ({ question: q.question, answer: answers[q.id] ?? '' })).filter((a) => a.answer.trim())) }} className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 space-y-2"><p className="font-medium">{clarify.request.reason}</p>{clarify.request.questions.map((q) => <label key={q.id} className="block">{q.question}<input value={answers[q.id] ?? ''} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} placeholder={q.placeholder} className="mt-1 w-full rounded border px-2 py-1" /></label>)}<button disabled={busy || !Object.values(answers).some(Boolean)} className="rounded bg-indigo-600 px-3 py-1.5 text-white">Gửi câu trả lời</button><button type="button" onClick={() => void send(clarify.original, [{ question: 'Có số liệu không?', answer: 'Không có số liệu cụ thể' }])} className="ml-2 underline">Không có số liệu</button></form>}
        {proposal && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2"><p className="font-semibold">Duyệt đề xuất</p><p>{proposal.summary}</p>{proposal.ops.map((op, i) => <label key={`${op.path}-${i}`} className="flex gap-2"><input type="checkbox" checked={checked.includes(i)} onChange={() => setChecked((c) => c.includes(i) ? c.filter((x) => x !== i) : [...c, i])} /><span><code>{op.path}</code><br />{op.op !== 'add' && <del>{display(readAt(cv, op.path))}</del>} → {display(op.value)}</span></label>)}<button disabled={busy || !checked.length} onClick={() => void applyProposal(checked)} className="rounded bg-indigo-600 px-3 py-1.5 text-white">Áp dụng mục đã chọn</button><button disabled={busy} onClick={() => void applyProposal([])} className="ml-2 underline">Bỏ qua</button></div>}
        {error && <p role="alert" className="rounded bg-rose-50 p-2 text-rose-700">{error}</p>}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); const value = input; setInput(''); void send(value) }} className="mt-3 flex gap-2"><input aria-label="Tin nhắn cho trợ lý" value={input} onChange={(e) => setInput(e.target.value)} disabled={busy} className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-xs" placeholder="Bạn muốn sửa gì?" /><button disabled={busy || !input.trim()} className="rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white">Gửi</button></form>
    </section>
  )
}
