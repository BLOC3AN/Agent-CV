#!/usr/bin/env tsx
/**
 * Migration runner — chạy tuần tự, ghi vào schema_migrations, idempotent.
 * Cố tình đơn giản: không cần thư viện ORM cho ~10 file SQL.
 *
 * Chạy: npm run db:migrate
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations')
const url =
  process.env.DATABASE_URL ?? 'postgres://postgres:hragent_dev@localhost:5433/hragent'

const client = new Client({ connectionString: url })
await client.connect()

await client.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`)

const { rows } = await client.query<{ version: string }>(
  'SELECT version FROM schema_migrations',
)
const done = new Set(rows.map((r) => r.version))

const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()
let applied = 0

for (const f of files) {
  const version = f.replace(/\.sql$/, '')
  if (done.has(version)) {
    console.log(`  · ${version} (đã chạy)`)
    continue
  }
  process.stdout.write(`  → ${version} ... `)
  try {
    await client.query(readFileSync(join(DIR, f), 'utf8'))
    console.log('✓')
    applied++
  } catch (err) {
    console.log('✗')
    console.error(`\n${(err as Error).message}\n`)
    await client.end()
    process.exit(1)
  }
}

console.log(`\n${applied} migration mới, ${files.length} tổng cộng.`)
await client.end()
