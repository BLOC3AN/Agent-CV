import React, { useMemo, useState } from 'react'
import { CVSchema, type CV } from '@hr/schema'
import { ApiError, createCV, deleteCV, saveCV } from '../lib/api'
import { useNavigate } from 'react-router-dom'

type Situation = 'student' | 'fresher' | 'working' | 'switcher'
interface Answers { situation?: Situation; target: string; hasWorked?: boolean; bodyTitle: string; bodyOrg: string; bodyHighlight: string; name: string; email: string }

const steps = ['Tình trạng hiện tại', 'Vị trí mục tiêu', 'Kinh nghiệm', 'Nội dung chính', 'Liên hệ'] as const

function buildCV(id: string, a: Answers): CV {
  return CVSchema.parse({
    schemaVersion: 2, id, title: a.name ? `CV của ${a.name}` : 'CV chưa đặt tên', lastModified: new Date().toISOString(), language: 'vi',
    sections: {
      intro: { fullName: a.name, title: a.target, email: a.email, summary: '' },
      ...(a.hasWorked ? { experience: [{ id: 'experience-0', title: a.bodyTitle, company: a.bodyOrg, startDate: '', endDate: '', current: false, highlights: a.bodyHighlight ? [a.bodyHighlight] : [] }] } : { projects: [{ id: 'projects-0', name: a.bodyTitle, role: '', startDate: '', endDate: '', highlights: a.bodyHighlight ? [a.bodyHighlight] : [] }] }),
    },
  })
}

export function GuidedRoute() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<Answers>({ target: '', bodyTitle: '', bodyOrg: '', bodyHighlight: '', name: '', email: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const bodyLabel = answers.hasWorked === false ? 'Tên dự án' : 'Chức danh / vai trò gần nhất'

  const canContinue = useMemo(() => {
    if (step === 0) return Boolean(answers.situation)
    if (step === 1) return answers.target.trim().length > 0
    if (step === 2) return answers.hasWorked !== undefined
    if (step === 3) return answers.bodyTitle.trim().length > 0
    return answers.name.trim().length > 0 && answers.email.trim().length > 0
  }, [answers, step])

  async function finish() {
    setBusy(true); setError(undefined)
    let created: { cvId: string } | undefined
    try {
      created = await createCV({ name: answers.name, email: answers.email, headline: answers.target })
      await saveCV(created.cvId, buildCV(created.cvId, answers))
      navigate(`/builder/${created.cvId}`)
    } catch (err) {
      if (created) { try { await deleteCV(created.cvId) } catch { /* preserve original error */ } }
      setError(err instanceof ApiError ? err.message : 'Không tạo được CV từ luồng hướng dẫn')
      setBusy(false)
    }
  }

  return <div data-testid="guided-flow" className="mx-auto max-w-2xl space-y-6 p-8"><div><p className="text-xs font-semibold text-indigo-600">BƯỚC {step + 1}/5</p><h1 className="mt-2 text-2xl font-bold">{steps[step]}</h1></div><div className="rounded-2xl border bg-white p-6 shadow-sm space-y-4">
    {step === 0 && <div className="grid gap-3 sm:grid-cols-2">{(['student', 'fresher', 'working', 'switcher'] as Situation[]).map((value) => <button key={value} onClick={() => setAnswers((a) => ({ ...a, situation: value }))} className={`rounded-xl border p-4 text-left ${answers.situation === value ? 'border-indigo-600 bg-indigo-50' : ''}`}>{({ student: 'Sinh viên', fresher: 'Mới ra trường', working: 'Đang đi làm', switcher: 'Chuyển ngành' })[value]}</button>)}</div>}
    {step === 1 && <label className="block text-sm">Bạn muốn ứng tuyển vị trí nào?<input autoFocus value={answers.target} onChange={(e) => setAnswers((a) => ({ ...a, target: e.target.value }))} className="mt-2 w-full rounded-xl border p-3" placeholder="Ví dụ: Backend Engineer" /></label>}
    {step === 2 && <div className="space-y-3"><p className="text-sm">Bạn đã từng đi làm chưa?</p><button onClick={() => setAnswers((a) => ({ ...a, hasWorked: true }))} className={`mr-2 rounded-xl border px-4 py-2 ${answers.hasWorked === true ? 'border-indigo-600 bg-indigo-50' : ''}`}>Có</button><button onClick={() => setAnswers((a) => ({ ...a, hasWorked: false }))} className={`rounded-xl border px-4 py-2 ${answers.hasWorked === false ? 'border-indigo-600 bg-indigo-50' : ''}`}>Chưa</button></div>}
    {step === 3 && <div className="space-y-3"><p className="text-sm text-slate-600">{answers.hasWorked === false ? 'Không sao — tập trung vào dự án là hoàn toàn hợp lệ.' : 'Bắt đầu từ công việc gần nhất.'}</p><label className="block text-sm">{bodyLabel}<input value={answers.bodyTitle} onChange={(e) => setAnswers((a) => ({ ...a, bodyTitle: e.target.value }))} className="mt-2 w-full rounded-xl border p-3" /></label><label className="block text-sm">{answers.hasWorked === false ? 'Môn học, CLB hoặc nơi tự làm' : 'Công ty / tổ chức'}<input value={answers.bodyOrg} onChange={(e) => setAnswers((a) => ({ ...a, bodyOrg: e.target.value }))} className="mt-2 w-full rounded-xl border p-3" /></label><label className="block text-sm">Bạn đã làm gì?<textarea value={answers.bodyHighlight} onChange={(e) => setAnswers((a) => ({ ...a, bodyHighlight: e.target.value }))} className="mt-2 w-full rounded-xl border p-3" rows={4} /></label></div>}
    {step === 4 && <div className="space-y-3"><label className="block text-sm">Họ và tên<input value={answers.name} onChange={(e) => setAnswers((a) => ({ ...a, name: e.target.value }))} className="mt-2 w-full rounded-xl border p-3" /></label><label className="block text-sm">Email<input type="email" value={answers.email} onChange={(e) => setAnswers((a) => ({ ...a, email: e.target.value }))} className="mt-2 w-full rounded-xl border p-3" /></label></div>}
    {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
  </div><div className="flex justify-between"><button disabled={step === 0 || busy} onClick={() => setStep((s) => s - 1)} className="rounded-xl border px-4 py-2 text-sm disabled:opacity-40">Quay lại</button>{step < 4 ? <button disabled={!canContinue || busy} onClick={() => setStep((s) => s + 1)} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Tiếp tục</button> : <button disabled={!canContinue || busy} onClick={() => void finish()} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy ? 'Đang tạo CV…' : 'Tạo CV'}</button>}</div></div>
}
