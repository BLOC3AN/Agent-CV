#!/usr/bin/env tsx
/** Chỉ đọc: mọi profile production phải là CV v2 hợp lệ sau SP-5. */
import { Client } from 'pg'
import { CVSchema } from '@hr/schema'

const url = process.env.DATABASE_URL ?? 'postgres://postgres:hragent_dev@localhost:5433/hragent'
const client = new Client({ connectionString: url })
await client.connect()

try {
  const { rows } = await client.query<{ id: string; data: unknown }>('SELECT id, data FROM profiles ORDER BY id')
  let checked = 0
  let invalid = 0
  for (const row of rows) {
    try {
      CVSchema.parse(row.data)
      checked++
    } catch (err) {
      invalid++
      console.error(`✗ ${row.id} — data không phải CV v2: ${(err as Error).message}`)
    }
  }
  console.log(`pair-check: ${checked}/${rows.length} CV v2 hợp lệ, ${invalid} lỗi.`)
  if (invalid) process.exitCode = 1
} finally {
  await client.end()
}
