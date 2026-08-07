import pg from 'pg'

/** Pool dùng chung. Tách ra để test inject được pool riêng. */
let shared: pg.Pool | null = null

export function getPool(url?: string): pg.Pool {
  if (!shared) {
    shared = new pg.Pool({
      connectionString:
        url ?? process.env.DATABASE_URL ?? 'postgres://postgres:hragent_dev@localhost:5433/hragent',
      max: 10,
      idleTimeoutMillis: 30_000,
    })
  }
  return shared
}

export async function closePool(): Promise<void> {
  if (shared) { await shared.end(); shared = null }
}

export type { Pool } from 'pg'
