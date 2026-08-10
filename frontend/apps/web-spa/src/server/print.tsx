import type { RequestHandler } from 'express'
import type { CSSProperties } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { type CV } from '@hr/schema'
import { CVBlockRenderer } from '../components/CVBlockRenderer'
import type { CV as WebCV, CVLayout as WebCVLayout } from '../types'
import { normalizeLayout } from '../lib/layout-draft'
import { PRINT_CSS } from '../lib/print-css'

interface Envelope {
  cv: CV & { templateId?: string; theme?: unknown; layout?: unknown; title?: string }
}

function PrintDocument({ cv, variant }: { cv: Envelope['cv']; variant: 'presentation' | 'ats' | 'thumbnail' }) {
  const layout = normalizeLayout(cv.layout as unknown as WebCVLayout | undefined)
  return <main className="cv-root" data-variant={variant} style={{ '--cv-accent': cv.design.accentColor } as CSSProperties}>
    <article className="cv-page">
      <CVBlockRenderer cv={cv as unknown as WebCV} layout={layout as unknown as WebCVLayout} variant="print" />
    </article>
  </main>
}

function escapeTitle(value: string): string {
  return value.replace(/[<>&"']/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[character] ?? character))
}

export function createPrintHandler(backendURL: string): RequestHandler {
  return async (req, res) => {
    const cvId = String(req.params.cvId ?? '')
    const variant = req.query.variant === 'ats' || req.query.variant === 'thumbnail' ? req.query.variant : 'presentation'
    if (!cvId) { res.status(400).send('Mã CV không hợp lệ'); return }
    let upstream: Response
    try {
      upstream = await fetch(`${backendURL.replace(/\/$/, '')}/api/cv/${encodeURIComponent(cvId)}`, {
        headers: { cookie: req.headers.cookie ?? '', 'X-CV-Schema': '2' },
      })
    } catch {
      res.status(502).send('Không kết nối được backend'); return
    }
    if (!upstream.ok) { res.status(upstream.status).send(await upstream.text()); return }
    const body = await upstream.json() as Envelope
    const cv = body.cv
    const title = escapeTitle(cv.title ?? 'CV')
    const html = `<!doctype html><html lang="${cv.language === 'en' ? 'en' : 'vi'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${PRINT_CSS}</style></head><body>${renderToStaticMarkup(<PrintDocument cv={cv} variant={variant} />)}</body></html>`
    res.type('html').send(html)
  }
}
