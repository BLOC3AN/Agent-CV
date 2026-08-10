#!/usr/bin/env tsx
/** Chỉ đọc: kiểm tra schema v2 của toàn bộ profile sau SP-5 cutover. */
import { Client } from 'pg'
import { CVSchema } from '@hr/schema'

const url = process.env.DATABASE_URL ?? 'postgres://postgres:hragent_dev@localhost:5433/hragent'
const client = new Client({ connectionString: url })
await client.connect()

try {
  const { rows } = await client.query<{ id: string; data: unknown }>('SELECT id, data FROM profiles ORDER BY id')
  let valid = 0
  let invalid = 0
  for (const row of rows) {
    try {
      CVSchema.parse(row.data)
      valid++
    } catch (err) {
      invalid++
      console.error(`✗ ${row.id} — data không phải CV v2: ${(err as Error).message}`)
    }
  }
  console.log(`v2 schema check: ${valid} hợp lệ, ${invalid} lỗi trên ${rows.length} hồ sơ.`)
  process.exitCode = invalid ? 1 : 0
} finally {
  await client.end()
}
