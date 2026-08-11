import type { RequestHandler } from 'express'
import type { CSSProperties } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CVLayoutSchema, CVSchema } from '@hr/schema'
import { CVBlockRenderer } from '../components/CVBlockRenderer'
import type { CV as WebCV, CVLayout as WebCVLayout } from '../types'
import type { CVEnvelope } from '../lib/api'
import { PRINT_CSS } from '../lib/print-css'
import { cvTypographyStyle } from '../lib/cv-typography'

interface Envelope {
  cv?: Partial<CVEnvelope>
}

function PrintDocument({ cv, layout, variant }: { cv: WebCV; layout: WebCVLayout; variant: 'presentation' | 'ats' | 'thumbnail' }) {
  return <main className="cv-root" data-variant={variant} style={{ '--cv-accent': cv.design.accentColor, ...cvTypographyStyle(cv.design) } as CSSProperties}>
    <article className="cv-page">
      <CVBlockRenderer cv={cv} layout={layout} variant="print" />
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
    let body: Envelope
    try {
      body = await upstream.json() as Envelope
    } catch {
      res.status(502).send('Dữ liệu CV không hợp lệ'); return
    }
    const cvResult = CVSchema.safeParse(body.cv?.profileSnapshot)
    const layoutResult = CVLayoutSchema.safeParse(body.cv?.layout)
    if (!cvResult.success || !layoutResult.success) {
      res.status(502).send('Dữ liệu CV không hợp lệ'); return
    }
    const cv = cvResult.data as unknown as WebCV
    const layout = layoutResult.data as unknown as WebCVLayout
    const title = escapeTitle(typeof body.cv?.title === 'string' ? body.cv.title : cv.title)
    const html = `<!doctype html><html lang="${cv.language === 'en' ? 'en' : 'vi'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${PRINT_CSS}</style></head><body>${renderToStaticMarkup(<PrintDocument cv={cv} layout={layout} variant={variant} />)}</body></html>`
    res.type('html').send(html)
  }
}
