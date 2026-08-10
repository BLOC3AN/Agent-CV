import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

interface Options {
  url: string
  output: string
  cookie?: string
  variant: 'presentation' | 'ats' | 'thumbnail'
  screenshot?: string
}

function optionsFromArgs(args: string[]): Options {
  const values = new Map<string, string>()
  for (let i = 0; i < args.length; i += 1) {
    const key = args[i]
    if (key?.startsWith('--')) values.set(key.slice(2), args[i + 1] ?? '')
  }
  const variant = values.get('variant')
  if (variant !== undefined && !['presentation', 'ats', 'thumbnail'].includes(variant)) {
    throw new Error('--variant phải là presentation, ats hoặc thumbnail')
  }
  const url = values.get('url')
  const output = values.get('output')
  if (!url || !output) throw new Error('Cần --url và --output')
  return {
    url,
    output,
    cookie: values.get('cookie'),
    variant: (variant ?? 'presentation') as Options['variant'],
    screenshot: values.get('screenshot'),
  }
}

const options = optionsFromArgs(process.argv.slice(2))
await mkdir(path.dirname(path.resolve(options.output)), { recursive: true })
if (options.screenshot) await mkdir(path.dirname(path.resolve(options.screenshot)), { recursive: true })

const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext({
    extraHTTPHeaders: options.cookie ? { cookie: options.cookie } : undefined,
  })
  const page = await context.newPage()
  const response = await page.goto(options.url, { waitUntil: 'networkidle' })
  if (!response?.ok()) throw new Error(`Print route trả HTTP ${response?.status() ?? 0}`)
  await page.evaluate(async () => { await document.fonts?.ready })
  await page.pdf({
    path: options.output,
    format: 'A4',
    printBackground: options.variant !== 'ats',
    preferCSSPageSize: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
  })
  if (options.screenshot) await page.screenshot({ path: options.screenshot, fullPage: true })
  console.log(`PDF: ${options.output}`)
  if (options.screenshot) console.log(`Screenshot: ${options.screenshot}`)
} finally {
  await browser.close()
}
