#!/usr/bin/env tsx
/**
 * Nạp KB từ file YAML vào Postgres — UC-61.
 *
 *   npm run kb:ingest [đường/dẫn/file.yaml]
 */
import { readdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { ingestKbFile } from '@hr/kb'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SEED_DIR = join(ROOT, 'kb/seed')

const files = process.argv[2]
  ? [resolve(process.argv[2])]
  : readdirSync(SEED_DIR).filter((f) => f.endsWith('.yaml')).map((f) => join(SEED_DIR, f))

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
let failed = false

for (const f of files) {
  process.stdout.write(`  → ${f.replace(ROOT + '/', '')} ... `)
  try {
    const r = await ingestKbFile(pool, f)
    console.log(`✓ ${r.inserted} đoạn (status: ${r.status})`)
    for (const s of r.skipped) console.log(`      ⚠ bỏ qua ${s.id}: ${s.reason}`)
    // Cảnh báo, KHÔNG chặn: phần lớn là ví dụ mẫu chứ không phải PII thật.
    // Curator là người quyết định, và họ ký tên chịu trách nhiệm khi kích hoạt.
    for (const w of r.piiWarnings) {
      console.log(`      ⚠ ${w.id} có ${w.kind} "${w.sample}" — kiểm giúp trước khi kích hoạt`)
    }
  } catch (err) {
    console.log('✗')
    console.error(`      ${(err as Error).message}`)
    failed = true
  }
}

await pool.end()
process.exit(failed ? 1 : 0)
