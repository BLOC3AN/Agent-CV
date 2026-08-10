import type { RequestHandler } from 'express'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CV } from '@hr/schema'

const PRINT_CSS = `
@page{size:A4;margin:0}*{box-sizing:border-box}.cv-root{font-family:Arial,"Segoe UI",sans-serif;color:#111827;line-height:1.5;font-size:10.5pt}.cv-page{width:210mm;min-height:297mm;padding:14mm;background:#fff;margin:0 auto}.cv-header{margin-bottom:5mm}.cv-name{font-size:20pt;font-weight:700;color:var(--cv-accent);margin:0 0 1mm}.cv-headline{font-size:11.5pt;color:#4b5563;margin:0 0 2mm}.cv-contact{display:flex;flex-wrap:wrap;gap:0 4mm;font-size:9.5pt;color:#4b5563}.cv-contact a{color:inherit;text-decoration:none}.cv-section{margin-bottom:4.5mm}.cv-section-title{font-size:11pt;font-weight:700;color:var(--cv-accent);letter-spacing:.03em;margin:0 0 2mm;border-bottom:.4mm solid var(--cv-accent);padding-bottom:1mm;text-transform:uppercase}.cv-entry{margin-bottom:3mm}.cv-entry-head{display:flex;justify-content:space-between;align-items:baseline;gap:4mm}.cv-entry-title{font-weight:600}.cv-entry-org,.cv-entry-date{color:#4b5563}.cv-entry-date{font-size:9.5pt;white-space:nowrap}.cv-bullets{margin:1mm 0 0;padding-left:5mm}.cv-bullets li{margin-bottom:.8mm}.cv-skills{display:flex;flex-wrap:wrap;gap:1.5mm 2.5mm}.cv-skill-group{display:flex;align-items:baseline;gap:2mm;margin-bottom:1mm}.cv-skill-group-name{min-width:22mm;font-weight:600;font-size:9.5pt}.cv-skill{background:#eef2ff;border-radius:1mm;padding:.6mm 2mm;font-size:9.5pt}.cv-two-col{display:grid;grid-template-columns:62% 1fr;gap:0 6mm}.cv-root[data-variant=ats] .cv-page{padding:12mm}.cv-root[data-variant=ats] .cv-skill{background:none;border-radius:0;padding:0}.cv-root[data-variant=ats] .cv-skills{display:block}.cv-root[data-variant=ats] .cv-skill-group{display:block}.cv-root[data-variant=ats] .cv-skill-group-name{display:none}.cv-root[data-variant=ats] .cv-skill::after{content:" · "}.cv-root[data-variant=ats] .cv-skill:last-child::after{content:""}.cv-root[data-variant=ats] .cv-two-col{display:block}.cv-root[data-variant=ats] .cv-entry-head{display:block}.cv-root[data-variant=ats] .cv-contact{display:block}.cv-root[data-variant=ats] .cv-section-title{border-bottom:0}.cv-root[data-variant=thumbnail] .cv-page{min-height:0;width:600px;padding:28px;transform-origin:top left}.cv-root[data-variant=thumbnail]{width:600px;overflow:hidden}.cv-root[data-variant=thumbnail] .cv-section{margin-bottom:10px}.cv-root[data-variant=thumbnail] .cv-page{max-height:850px;overflow:hidden}@media print{.cv-page{margin:0}.cv-root{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
`

interface Envelope {
  cv: CV & { templateId?: string; theme?: unknown; layout?: unknown; title?: string }
}

function PrintDocument({ cv, variant }: { cv: Envelope['cv']; variant: 'presentation' | 'ats' | 'thumbnail' }) {
  const { intro, experience, projects, education, skills, activities, certifications, languages } = cv.sections
  const section = (title: string, children: ReactNode) => (
    <section className="cv-section"><h2 className="cv-section-title">{title}</h2>{children}</section>
  )
  return <main className="cv-root" data-variant={variant}>
    <article className="cv-page">
      <header className="cv-header"><h1 className="cv-name">{intro.fullName}</h1><p className="cv-headline">{intro.title}</p>
        <div className="cv-contact">{[intro.email, intro.phone, intro.location, intro.website].filter(Boolean).map((value) => <span key={value}>{value}</span>)}</div>
        {intro.summary && <p>{intro.summary}</p>}
      </header>
      {experience.length > 0 && section('Kinh nghiệm', <>{experience.map((item) => <div className="cv-entry" key={item.id}><div className="cv-entry-head"><strong className="cv-entry-title">{item.title}</strong><span className="cv-entry-org">{item.company}</span><span className="cv-entry-date">{[item.startDate, item.endDate].filter(Boolean).join(' – ')}</span></div><ul className="cv-bullets">{item.highlights.map((text, i) => <li key={`${item.id}-${i}`}>{text}</li>)}</ul></div>)}</>)}
      {projects.length > 0 && section('Dự án', <>{projects.map((item) => <div className="cv-entry" key={item.id}><strong className="cv-entry-title">{item.name}</strong><ul className="cv-bullets">{item.highlights.map((text, i) => <li key={`${item.id}-${i}`}>{text}</li>)}</ul></div>)}</>)}
      {education.length > 0 && section('Học vấn', <>{education.map((item) => <div className="cv-entry" key={item.id}><strong className="cv-entry-title">{item.school}</strong><span className="cv-entry-org">{item.degree} {item.fieldOfStudy}</span></div>)}</>)}
      {skills.length > 0 && section('Kỹ năng', <div className="cv-skills">{skills.flatMap((group) => group.skills).map((skill) => <span className="cv-skill" key={skill}>{skill}</span>)}</div>)}
      {activities.length > 0 && section('Hoạt động', <>{activities.map((item) => <div className="cv-entry" key={item.id}><strong className="cv-entry-title">{item.organization}</strong><span className="cv-entry-org">{item.role}</span><ul className="cv-bullets">{item.highlights.map((text, i) => <li key={`${item.id}-${i}`}>{text}</li>)}</ul></div>)}</>)}
      {certifications.length > 0 && section('Chứng chỉ', <>{certifications.map((item) => <div className="cv-entry" key={item.id}><strong className="cv-entry-title">{item.name}</strong><span className="cv-entry-org">{item.issuer}</span></div>)}</>)}
      {languages.length > 0 && section('Ngoại ngữ', <div className="cv-skills">{languages.map((item) => <span className="cv-skill" key={item.id}>{item.language} — {item.proficiency}</span>)}</div>)}
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
