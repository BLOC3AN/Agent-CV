import 'server-only'
import { getPool, JobRepo } from '@hr/db'

/**
 * Read-only job access for the server-rendered review page.
 *
 * Business API and dispatch now live in Go. Next keeps only this small reader
 * so a user can revisit an import review page while the UI is rendered.
 */

const g = globalThis as unknown as { __hrJobRepo?: JobRepo }

export function jobRepo(): JobRepo {
  if (!g.__hrJobRepo) g.__hrJobRepo = new JobRepo(getPool())
  return g.__hrJobRepo
}

/** Tách mã lỗi khỏi chuỗi `"CODE: thông điệp"` mà JobRepo ghi xuống. */
export function splitError(error: string | null): { code: string; message: string } | null {
  if (!error) return null
  const m = /^([A-Z_]+): ([\s\S]*)$/.exec(error)
  return m ? { code: m[1]!, message: m[2]! } : { code: 'INTERNAL', message: error }
}
