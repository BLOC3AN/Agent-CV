import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { RubricSchema, type Rubric } from './rubric.js'

/**
 * Nạp rubric từ file KB — TDD §10.3.
 *
 * Giai đoạn 1 đọc thẳng từ YAML. Khi M5 xong, KB nằm trong Postgres và hàm này
 * đổi nguồn đọc; chữ ký giữ nguyên nên lớp chấm điểm không phải sửa.
 */

const SEED = resolve(dirname(fileURLToPath(import.meta.url)), '../../../kb/seed/it-software-vn.yaml')

export function loadRubrics(path = SEED): Rubric[] {
  const raw = parseYaml(readFileSync(path, 'utf8')) as { rubrics?: unknown[] }
  const out: Rubric[] = []
  const errors: string[] = []

  for (const [i, r] of (raw.rubrics ?? []).entries()) {
    const parsed = RubricSchema.safeParse(r)
    if (parsed.success) out.push(parsed.data)
    else errors.push(`rubric[${i}]: ${parsed.error.issues[0]?.message ?? 'không hợp lệ'}`)
  }

  // Ném lỗi thay vì bỏ qua: rubric hỏng mà im lặng thì điểm vẫn ra, chỉ là
  // thiếu mất một phần kinh nghiệm HR — và không ai biết.
  if (errors.length > 0) {
    throw new Error(`KB rubric không hợp lệ:\n  ${errors.join('\n  ')}`)
  }
  return out
}

let cached: Rubric[] | null = null
export function rubrics(path?: string): Rubric[] {
  if (path) return loadRubrics(path)
  if (!cached) cached = loadRubrics()
  return cached
}
