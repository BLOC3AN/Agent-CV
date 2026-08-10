#!/usr/bin/env tsx
/**
 * Chỉ đọc: kiểm tra mọi profile đã có data_v2 có thể khôi phục đúng data v1.
 * Không UPDATE/INSERT/DELETE; dùng cùng diffRestored với roundtrip-check.
 */
import { Client } from 'pg'
import { diffRestored } from './roundtrip-compare.js'

const url = process.env.DATABASE_URL ?? 'postgres://postgres:hragent_dev@localhost:5433/hragent'
const client = new Client({ connectionString: url })
await client.connect()

try {
  const { rows } = await client.query<{ id: string; data: unknown; data_v2: unknown }>(
    'SELECT id, data, data_v2 FROM profiles ORDER BY id',
  )
  let checked = 0
  let missing = 0
  let mismatched = 0
  for (const row of rows) {
    if (row.data_v2 === null) {
      missing++
      console.error(`✗ ${row.id} — thiếu data_v2`)
      continue
    }
    checked++
    const diff = diffRestored(row.data, row.data_v2)
    if (diff) {
      mismatched++
      console.error(`✗ ${row.id} — ${diff}`)
    }
  }
  console.log(`pair-check: ${checked}/${rows.length} cặp đã kiểm tra, ${mismatched} lệch, ${missing} thiếu data_v2.`)
  if (mismatched || missing) process.exitCode = 1
} finally {
  await client.end()
}
