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
    // Một TRANSACTION cho cả migration + bản ghi version.
    //
    // Hai lỗi của bản đầu, cả hai đều im lặng:
    //   1. Chạy SQL nhưng KHÔNG ghi `schema_migrations`. Migration chạy lại
    //      mỗi lượt; lần đầu qua được vì `CREATE TABLE` chưa va vào gì, lần
    //      sau mới nổ "column already exists" — rất lâu sau khi gây ra lỗi.
    //   2. Không có transaction. Migration hỏng giữa chừng để lại nửa lược đồ
    //      đã đổi, và không có cách nào biết đã tới đâu.
    await client.query('BEGIN')
    await client.query(readFileSync(join(DIR, f), 'utf8'))
    await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version])
    await client.query('COMMIT')
    console.log('✓')
    applied++
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    console.log('✗')
    console.error(`\n${(err as Error).message}\n`)
    await client.end()
    process.exit(1)
  }
}

console.log(`\n${applied} migration mới, ${files.length} tổng cộng.`)
await client.end()
