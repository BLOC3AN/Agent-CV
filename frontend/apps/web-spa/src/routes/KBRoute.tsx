import React, { useEffect, useState } from 'react'
import { ApiError, listKBSources, updateKBSource, type KBSource } from '../lib/api'

export function KBRoute() {
  const [sources, setSources] = useState<KBSource[]>([])
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState<string>()
  async function load() { try { setSources(await listKBSources()) } catch (err) { setError(err instanceof ApiError ? err.message : 'Không tải được KB') } }
  useEffect(() => { void load() }, [])
  async function activate(source: KBSource) {
    if (!source.canActivate) { setError('Nguồn phải có curator trước khi kích hoạt'); return }
    setBusy(source.id); setError(undefined)
    try { await updateKBSource({ sourceId: source.id, status: 'active' }); await load() } catch (err) { setError(err instanceof ApiError ? err.message : 'Không cập nhật được nguồn') } finally { setBusy(undefined) }
  }
  return <div data-testid="view-kb" className="mx-auto max-w-5xl space-y-6 p-8"><div><h1 className="text-2xl font-bold">Kho tri thức</h1><p className="text-sm text-slate-600">Curator duyệt nguồn trước khi lời khuyên được trích dẫn.</p></div>{error && <p role="alert" className="text-sm text-rose-600">{error}</p>}<div className="space-y-3">{sources.map((source) => <article key={source.id} className="rounded-2xl border bg-white p-5"><div className="flex items-start justify-between gap-4"><div><h2 className="font-bold">{source.title}</h2><p className="text-sm text-slate-600">{source.authorName || 'Chưa có curator'}{source.authorTitle ? ` · ${source.authorTitle}` : ''} · {source.chunkCount} chunks</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs">{source.status}</span></div>{source.status !== 'active' && <button disabled={busy === source.id} onClick={() => void activate(source)} className="mt-4 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">{busy === source.id ? 'Đang duyệt…' : 'Kích hoạt nguồn'}</button>}</article>)}{!sources.length && !error && <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-slate-500">Chưa có nguồn KB.</p>}</div></div>
}
