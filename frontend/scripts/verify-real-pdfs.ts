import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { access } from 'node:fs/promises'

const run = promisify(execFile)
const rootCandidates = [
  path.resolve(process.cwd(), '..'),
  path.resolve(process.cwd(), '..', '..', '..', '..'),
]
const root = await (async () => {
  for (const candidate of rootCandidates) {
    try { await access(path.join(candidate, 'var', 'storage')); return candidate } catch { /* try next */ }
  }
  throw new Error('Không tìm thấy var/storage; đặt script trong workspace HR-agent')
})()
const storage = path.join(root, 'var', 'storage')
const positive = [
  ['b8', 'LE\nTHANH\nHAI'],
  ['c3', 'Quan Pham'],
  ['cf', 'Sơn Trịnh'],
  ['d9', 'Y YEN NHI'],
] as const
const negative = ['63', '68', 'b7']
const normalize = (value: string) => value.replace(/\s+/g, ' ').trim().toLocaleLowerCase('vi')

async function firstPDF(folder: string): Promise<string> {
  const { stdout } = await run('find', [path.join(storage, folder), '-maxdepth', '1', '-type', 'f', '-name', '*.pdf', '-print', '-quit'])
  const file = stdout.trim()
  if (!file) throw new Error(`Không có PDF trong storage/${folder}`)
  return file
}

for (const [folder, expected] of positive) {
  const file = await firstPDF(folder)
  await access(file)
  const { stdout } = await run('pdftotext', ['-layout', file, '-'])
  if (stdout.trim().length < 80) throw new Error(`${folder}: PDF không có text-layer đủ dùng`)
  if (!normalize(stdout).includes(normalize(expected))) {
    throw new Error(`${folder}: không tìm thấy tên kỳ vọng ${expected}`)
  }
  console.log(`PASS positive ${folder}: ${path.basename(file)}`)
}

for (const folder of negative) {
  const file = await firstPDF(folder)
  const { stdout } = await run('pdftotext', ['-layout', file, '-'])
  const compact = stdout.replace(/\s+/g, ' ').trim()
  if (compact.length < 40) throw new Error(`${folder}: PDF không thể đọc text để đánh giá negative fixture`)
  console.log(`PASS negative fixture ${folder}: không dùng làm CV (${compact.slice(0, 72)}…)`)
}
