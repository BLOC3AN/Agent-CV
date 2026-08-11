import { resolveCVTypography } from './cv-typography'

export const PRINT_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Lato:wght@400;600;700&family=Open+Sans:wght@400;600;700&family=Roboto:wght@400;500;700&display=swap');
@page{size:A4;margin:0}
*{box-sizing:border-box}
.cv-root,.cv-root *{font-family:var(--cv-font-family,Calibri,Arial,sans-serif)}
.cv-root{color:#111827;line-height:var(--cv-line-height,1.3);font-size:var(--cv-body-size,10.5pt)}
.cv-page{width:210mm;min-height:297mm;padding:var(--cv-padding-top,20mm) var(--cv-padding-right,20mm) var(--cv-padding-bottom,20mm) var(--cv-padding-left,20mm);background:#fff;margin:0 auto;box-sizing:border-box;text-align:var(--cv-text-align,left)}
.cv-header{margin-bottom:5mm}
.cv-avatar{width:24mm;height:24mm;border-radius:50%;object-fit:cover}
.cv-name{font-size:var(--cv-header-size,20pt);font-weight:700;color:var(--cv-accent);margin:0 0 1mm}
.cv-headline{font-size:11.5pt;color:#4b5563;margin:0 0 2mm}
.cv-contact{display:flex;flex-wrap:wrap;gap:0 4mm;font-size:9.5pt;color:#4b5563}
.cv-contact a{color:inherit;text-decoration:none}
.cv-section{margin-bottom:4.5mm}
.cv-section-title{font-size:var(--cv-section-title-size,13pt);font-weight:700;color:var(--cv-accent);letter-spacing:.03em;margin:0 0 2mm;border-bottom:.4mm solid var(--cv-accent);padding-bottom:1mm;text-transform:uppercase;break-after:avoid}
.cv-entry{margin-bottom:3mm;break-inside:auto}
.cv-entry-head{display:flex;justify-content:space-between;align-items:baseline;gap:4mm;text-align:left}
.cv-entry-heading{min-width:0;text-align:left}
.cv-entry-title{font-weight:700}
.cv-entry-sep{color:#94a3b8}
.cv-entry-org{color:#334155}
.cv-entry-date{flex:none;margin-left:auto;color:#4b5563;white-space:nowrap;text-align:right;font-variant-numeric:tabular-nums}
.cv-bullets{margin:1mm 0 0;padding-left:5mm}
.cv-bullets li{margin-bottom:.8mm}
.cv-field-block{display:block}
.cv-field-date-range{white-space:nowrap}
.cv-field-tags{display:inline-flex;flex-wrap:wrap;gap:1mm}
.cv-field-tag{display:inline-block;background:#eef2ff;border-radius:1mm;padding:.4mm 1.5mm}
.cv-skills{display:flex;flex-wrap:wrap;gap:1.5mm 2.5mm}
.cv-skill-group{display:flex;align-items:baseline;gap:2mm;margin-bottom:1mm}
.cv-skill-group-name{min-width:22mm;font-weight:600;font-size:9.5pt}
.cv-skill{background:#eef2ff;border-radius:1mm;padding:.6mm 2mm;font-size:9.5pt}
.cv-two-col{display:grid;grid-template-columns:62% 1fr;gap:0 6mm}
.cv-root[data-variant=ats] .cv-page{padding:var(--cv-padding-top,20mm) var(--cv-padding-right,20mm) var(--cv-padding-bottom,20mm) var(--cv-padding-left,20mm)}
.cv-root[data-variant=ats] .cv-skill{background:none;border-radius:0;padding:0}
.cv-root[data-variant=ats] .cv-skills{display:block}
.cv-root[data-variant=ats] .cv-skill-group{display:block}
.cv-root[data-variant=ats] .cv-skill-group-name{display:none}
.cv-root[data-variant=ats] .cv-skill::after{content:" · "}
.cv-root[data-variant=ats] .cv-skill:last-child::after{content:""}
.cv-root[data-variant=ats] .cv-two-col{display:block}
.cv-root[data-variant=ats] .cv-entry-head{display:block}
.cv-root[data-variant=ats] .cv-entry-date{display:block;margin-left:0;text-align:left}
.cv-root[data-variant=ats] .cv-contact{display:block}
.cv-root[data-variant=ats] .cv-section-title{border-bottom:0}
.cv-root[data-variant=thumbnail] .cv-page{min-height:0;width:600px;padding:28px;transform-origin:top left}
.cv-root[data-variant=thumbnail]{width:600px;overflow:hidden}
.cv-root[data-variant=thumbnail] .cv-section{margin-bottom:10px}
.cv-root[data-variant=thumbnail] .cv-page{max-height:850px;overflow:hidden}
@media print{.cv-page{width:auto;min-height:0;padding:0;margin:0;break-after:auto}.cv-root{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
`

export function printCSSForDesign(design: Parameters<typeof resolveCVTypography>[0]): string {
  const typography = resolveCVTypography(design)
  const margin = typography.pageMargin
  const top = typography.paddingTop + margin
  const right = typography.paddingRight + margin
  const bottom = typography.paddingBottom + margin
  const left = typography.paddingLeft + margin
  return `${PRINT_CSS}\n@page{size:A4;margin:${top}mm ${right}mm ${bottom}mm ${left}mm}`
}
