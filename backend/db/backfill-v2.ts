#!/usr/bin/env tsx
/**
 * Verification entrypoint retained for deployment runbooks.
 *
 * Production storage is CV v2-only after migration 012. There is deliberately
 * It validates the single production CV representation and never mutates data.
 */
import { Client } from 'pg'
import { CVSchema } from '@hr/schema'

const url = process.env.DATABASE_URL ?? 'postgres://postgres:hragent_dev@localhost:5433/hragent'
const client = new Client({ connectionString: url })
await client.connect()
try {
  const { rows } = await client.query<{ id: string; data: unknown }>('SELECT id, data FROM profiles ORDER BY id')
  const failures: string[] = []
  for (const row of rows) {
    const result = CVSchema.safeParse(row.data)
    if (!result.success) failures.push(row.id)
  }
  if (failures.length) {
    console.error(`Schema v2 không hợp lệ: ${failures.join(', ')}`)
    process.exitCode = 1
  } else {
    console.log(`Backfill không cần chạy: database đã ở schema v2 production (${rows.length}/${rows.length}).`)
  }
} finally {
  await client.end()
}
