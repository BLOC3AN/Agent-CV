import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Gateway, makeSectionTask } from '@hr/ai'
import { chunkSection } from '../src/cv-chunk.js'

/**
 * ĐẾM số chỗ làm đọc được từ CV nhiều trang — TDD §8.1.2, TC-21-*.
 *
 * ── Vì sao test này tồn tại ──
 * Người dùng báo: CV của họ có 5 chỗ làm mà app chỉ hiện 1. Nguyên nhân là mục
 * `work` dài 5.301 ký tự cần nhiều token output hơn hạn mức, JSON bị cắt giữa
 * câu, và cả mục hỏng.
 *
 * `cv-chunk.test.ts` kiểm việc CHIA là đúng — không mất chữ, không cắt giữa một
 * chỗ làm. Nhưng chia đúng KHÔNG có nghĩa là model đọc ra đủ. Giữa hai điều đó
 * là lượt gọi model, và đó chính là chỗ hỏng ban đầu.
 *
 * Test này đo đầu ra THẬT: bao nhiêu chỗ làm tới được tay người dùng.
 *
 *   npm run test:int
 */

const PDFKIT = process.env['PDFKIT_URL'] ?? 'http://localhost:8100'

/** Số chỗ làm tối thiểu phải đọc được — đếm tay từ file PDF. */
const KY_VONG: Record<string, { toiThieu: number; phaiCo: string[] }> = {
  // 5 chỗ làm, mục `work` dài 5.301 ký tự — chính là CV làm lộ ra lỗi
  'CV-06': { toiThieu: 5, phaiCo: ['iMESPRO', 'ZALO', 'REALTIME'] },
  // 4 chỗ làm, 3.077 ký tự, dấu đầu dòng ● (U+25CF) từ DOCX
  'CV-04': { toiThieu: 4, phaiCo: ['iTechwx', 'Concentrix', 'Nouvolution'] },
}

let up = false
beforeAll(async () => {
  up = await fetch(`${PDFKIT}/health`, { signal: AbortSignal.timeout(5_000) }).then(
    (r) => r.ok,
    () => false,
  )
}, 30_000)

async function docLucWork(cv: string): Promise<string | null> {
  const path = resolve(import.meta.dirname, `../../../eval/cv/${cv}.pdf`)
  const buf = await readFile(path).catch(() => null)
  if (!buf) return null

  const form = new FormData()
  form.append('file', new Blob([buf]), `${cv}.pdf`)
  const res = await fetch(`${PDFKIT}/segment`, { method: 'POST', body: form })
  const seg = (await res.json()) as { merged?: Record<string, string> }
  return seg.merged?.['work'] ?? null
}

describe('CV nhiều trang — đọc ĐỦ số chỗ làm', () => {
  for (const [cv, { toiThieu, phaiCo }] of Object.entries(KY_VONG)) {
    it(
      `${cv}: đọc được ít nhất ${toiThieu} chỗ làm`,
      async () => {
        if (!up) {
          console.warn('⏭  pdfkit không phản hồi')
          return
        }
        const work = await docLucWork(cv)
        if (work === null) {
          console.warn(`⏭  ${cv}.pdf không có trên máy này (PII, không commit)`)
          return
        }

        const chunks = chunkSection(work, 1_800)
        const gw = new Gateway()
        const task = makeSectionTask('work')

        const items: { org?: string; role?: string }[] = []
        let hong = 0
        for (const c of chunks) {
          const r = await gw.run(task, { kind: 'work', text: c, outputLanguage: 'vi' })
          if (r.ok) items.push(...((r.data as { items?: { org?: string }[] }).items ?? []))
          else hong++
        }

        const orgs = items.map((i) => i.org ?? '?')
        console.log(`  ${cv}: ${work.length} ký tự → ${chunks.length} khúc → ${items.length} chỗ làm`)
        for (const o of orgs) console.log(`     · ${o}`)

        // Một khúc hỏng nghĩa là mất nguyên một chỗ làm — không được im lặng
        expect(hong, `${hong}/${chunks.length} khúc hỏng`).toBe(0)
        expect(items.length, `chỉ đọc được ${items.length} chỗ làm`).toBeGreaterThanOrEqual(toiThieu)

        // Đếm số lượng thôi chưa đủ: model có thể tách nhầm một chỗ làm thành
        // hai mà vẫn đủ số. Kiểm những nơi làm việc CÓ THẬT trong file.
        for (const ten of phaiCo) {
          expect(
            orgs.some((o) => o.toUpperCase().includes(ten.toUpperCase())),
            `thiếu "${ten}" trong: ${orgs.join(' | ')}`,
          ).toBe(true)
        }
      },
      300_000,
    )
  }
})
