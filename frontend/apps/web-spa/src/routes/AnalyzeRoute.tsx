import React, { useEffect, useState } from 'react'
import { useLocale } from '../lib/i18n'
import { useNavigate, useParams } from 'react-router-dom'
import { ApiError, getCitations, listCVs, startAnalyze, type AnalyzeReport, type Citation } from '../lib/api'

export function AnalyzeRoute() {
  const { t } = useLocale()
  const { cvId } = useParams<{ cvId: string }>()
  const navigate = useNavigate()
  const [selected, setSelected] = useState(cvId ?? '')
  const [cvs, setCVs] = useState<{ id: string; title: string }[]>([])
  const [jd, setJD] = useState('')
  const [report, setReport] = useState<AnalyzeReport>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [citations, setCitations] = useState<Citation[]>([])

  useEffect(() => { if (!cvId) void listCVs().then(setCVs).catch(() => setError('Không tải được danh sách CV')) }, [cvId])
  useEffect(() => {
    if (!cvId || typeof EventSource === 'undefined') return
    const source = new EventSource(`/api/analyze/${encodeURIComponent(cvId)}/stream`)
    source.addEventListener('report', (e) => setReport(JSON.parse((e as MessageEvent<string>).data) as AnalyzeReport))
    source.addEventListener('done', (e) => { setReport(JSON.parse((e as MessageEvent<string>).data) as AnalyzeReport); setBusy(false); source.close() })
    source.onerror = () => { if (busy) setError('Không đọc được tiến độ phân tích'); source.close() }
    return () => source.close()
  }, [cvId])

  useEffect(() => {
    const refs = [...new Set((report?.gaps ?? []).flatMap((gap) => gap.kbRefs ?? []))]
    if (!refs.length) { setCitations([]); return }
    void getCitations(refs).then(setCitations).catch(() => setCitations([]))
  }, [report])

  async function submit() {
    if (!selected || jd.trim().length < 50) return
    setBusy(true); setError(undefined); setReport(undefined)
    try { const result = await startAnalyze({ cvId: selected, jdText: jd.trim(), language: 'vi' }); navigate(`/analyze/${result.cvId}`) }
    catch (err) { setBusy(false); setError(err instanceof ApiError ? err.message : 'Không tạo được phiên phân tích') }
  }

  if (!cvId) return <div data-testid="view-job-match" className="mx-auto max-w-3xl space-y-5 p-8"><h1 className="text-2xl font-bold">{t('jdAnalysis')}</h1><select aria-label={t('pickCV')} value={selected} onChange={(e) => setSelected(e.target.value)} className="w-full rounded-xl border p-3"><option value="">{t('pickCV')}</option>{cvs.map((cv) => <option key={cv.id} value={cv.id}>{cv.title}</option>)}</select><textarea aria-label={t('jobDescription')} value={jd} onChange={(e) => setJD(e.target.value)} rows={12} className="w-full rounded-xl border p-3" placeholder={t('pasteJD')} /><button disabled={busy || !selected || jd.trim().length < 50} onClick={() => void submit()} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy ? t('analyzing') : t('analyzeAction')}</button>{error && <p role="alert" className="text-sm text-rose-600">{error}</p>}</div>

  return <div data-testid="view-job-match" className="mx-auto max-w-5xl space-y-5 p-8"><h1 className="text-2xl font-bold">Kết quả đối chiếu JD</h1>{busy && !report && <p className="text-sm text-slate-500">Đang đối chiếu CV với JD…</p>}{report?.degraded && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Phân tích đang ở chế độ suy giảm: {report.degradedReason ?? 'một số model không khả dụng'}.</p>}{report && <><div className="rounded-2xl border bg-white p-5"><span className="text-4xl font-bold text-indigo-700">{report.overall ?? 0}%</span><p className="mt-2 text-sm text-slate-600">Điểm tương thích tổng thể</p></div><div className="grid gap-3 sm:grid-cols-2">{Object.entries(report.breakdown ?? {}).map(([key, value]) => <div key={key} className="rounded-xl border bg-white p-4"><span className="text-xs uppercase text-slate-500">{key}</span><strong className="ml-2">{value}%</strong></div>)}</div><section className="rounded-2xl border bg-white p-5"><h2 className="font-bold">Khoảng thiếu</h2><ul className="mt-3 space-y-2 text-sm">{(report.gaps ?? []).map((gap) => <li key={gap.id} className="rounded-lg bg-slate-50 p-3"><strong>{gap.requirement}</strong><span className="ml-2 text-slate-500">{gap.advice ?? gap.reason}</span>{gap.kbRefs?.length > 0 && citations.length > 0 && <div className="mt-2 border-l-2 border-indigo-200 pl-3 text-xs text-slate-600">{citations.filter((citation) => gap.kbRefs.includes(citation.chunkId)).map((citation) => <p key={citation.chunkId}>“{citation.excerpt ?? citation.text ?? ''}” — {citation.authorName}{citation.authorTitle ? `, ${citation.authorTitle}` : ''}</p>)}</div>}</li>)}</ul></section></>}{error && <p role="alert" className="text-sm text-rose-600">{error}</p>}</div>
}
