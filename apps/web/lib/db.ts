import 'server-only'
import { getPool, ProfileRepo } from '@hr/db'

/** Singleton cho Next.js — tránh tạo pool mới mỗi lần hot-reload */
const g = globalThis as unknown as { __hrRepo?: ProfileRepo }

export function profileRepo(): ProfileRepo {
  if (!g.__hrRepo) g.__hrRepo = new ProfileRepo(getPool())
  return g.__hrRepo
}
