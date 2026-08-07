import { getPool } from '@hr/db'
import { KbCurator } from '@/components/kb/KbCurator'

/**
 * `/kb` — duyệt tri thức HR (UC-62).
 *
 * Người dùng của màn hình này là CURATOR, không phải sinh viên. Nó cố tình thô
 * sơ: đọc đoạn tri thức, điền tên người chịu trách nhiệm, kích hoạt. Mọi thứ
 * khác (sửa nội dung, thêm nguồn) làm ở file YAML rồi chạy `npm run kb:ingest`
 * — sửa qua web sẽ mất lịch sử git, mà lịch sử là thứ cần nhất với tri thức.
 */

export const dynamic = 'force-dynamic'

interface ChunkRow {
  id: string
  source_id: string
  content_type: string
  text: string
  breadcrumb: string | null
  section: string[]
  seniority: string[]
  language: string
  priority: number
}

export default async function KbPage() {
  const { rows } = await getPool().query<ChunkRow>(
    `SELECT id, source_id, content_type, text, breadcrumb, section, seniority,
            language, priority
       FROM kb_chunks
      WHERE language = 'vi'
      ORDER BY content_type, priority DESC`,
  )

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-xl font-semibold">Tri thức HR</h1>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
        Mọi lời khuyên hệ thống đưa ra đều phải trích dẫn được về một người thật.
        Nguồn chưa có tên người chịu trách nhiệm sẽ không được dùng.
      </p>

      <KbCurator
        chunks={rows.map((r) => ({
          id: r.id,
          sourceId: r.source_id,
          contentType: r.content_type,
          text: r.text,
          breadcrumb: r.breadcrumb,
          section: r.section ?? [],
          seniority: r.seniority ?? [],
          priority: r.priority,
        }))}
      />
    </main>
  )
}
