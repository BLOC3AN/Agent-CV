import { notFound } from 'next/navigation'
import { getPool } from '@hr/db'
import { ProfileSchema } from '@hr/schema'
import type { Layout, Theme } from '@hr/templates'
import { BuilderShell } from '@/components/editor/BuilderShell'

/**
 * Màn hình soạn CV — UC-24, UC-31, FRONTEND.md §3.
 *
 * Server Component nạp dữ liệu, giao cho BuilderShell (client) lo tương tác.
 * Không cần LLM → hoạt động bình thường khi model server chết (TC-DEG-01).
 */

export const dynamic = 'force-dynamic'

export default async function BuilderPage({
  params,
}: {
  params: Promise<{ cvId: string }>
}) {
  const { cvId } = await params

  const { rows } = await getPool().query<{
    profile_id: string
    profile_data: unknown
    template_id: string
    theme: unknown
    layout: unknown
    title: string | null
  }>(
    // Đọc hồ sơ SỐNG (`p.data`), KHÔNG phải `c.profile_snapshot`.
    // Snapshot là ảnh chụp lúc tạo CV, dùng để đối chiếu "lúc nộp trông thế
    // nào" (TDD §8.5) — render từ nó thì mọi chỉnh sửa sẽ không hiện ra.
    // Bí danh cũ `p.data AS profile_snapshot` đọc như đang dùng snapshot,
    // khiến người đọc tưởng phần tách bản đã xong.
    `SELECT c.profile_id, p.data AS profile_data, c.template_id,
            c.theme, c.layout, c.title
     FROM cv_documents c
     JOIN profiles p ON p.id = c.profile_id
     WHERE c.id = $1`,
    [cvId],
  )
  if (rows.length === 0) notFound()

  const row = rows[0]!
  const profile = ProfileSchema.parse(row.profile_data)

  return (
    <BuilderShell
      profileId={row.profile_id}
      cvId={cvId}
      initialProfile={profile}
      templateId={row.template_id}
      theme={(row.theme ?? {}) as Partial<Theme>}
      layout={(row.layout ?? {}) as Partial<Layout>}
      title={row.title ?? 'CV chưa đặt tên'}
    />
  )
}
