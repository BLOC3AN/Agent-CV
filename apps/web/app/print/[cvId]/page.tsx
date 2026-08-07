import { notFound } from 'next/navigation'
import { getPool } from '@hr/db'
import { ProfileSchema } from '@hr/schema'
import { getTemplate, type TemplateVariant } from '@hr/templates'

/**
 * Trang render nội bộ cho Playwright → PDF (TDD §3.3, BR-32.x).
 *
 * KHÔNG hiện với người dùng. Đây là mắt xích khiến bản xem trước khớp file PDF:
 * cùng một component `@hr/templates`, chỉ khác `variant`.
 *
 * Server Component thuần — không JS phía client, không hydrate. Playwright chỉ
 * cần HTML + CSS là in được, không phải chờ React khởi động.
 */

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ cvId: string }>
  searchParams: Promise<{ variant?: string }>
}

const VALID: TemplateVariant[] = ['presentation', 'ats', 'thumbnail']

export default async function PrintPage({ params, searchParams }: Props) {
  const { cvId } = await params
  const sp = await searchParams
  const variant = (VALID as string[]).includes(sp.variant ?? '')
    ? (sp.variant as TemplateVariant)
    : 'presentation'

  const { rows } = await getPool().query<{
    profile_snapshot: unknown
    template_id: string
    theme: unknown
    layout: unknown
  }>(
    `SELECT profile_snapshot, template_id, theme, layout
     FROM cv_documents WHERE id = $1`,
    [cvId],
  )
  if (rows.length === 0) notFound()

  const row = rows[0]!
  const profile = ProfileSchema.parse(row.profile_snapshot)
  const Template = getTemplate(row.template_id).component

  return (
    <Template
      profile={profile}
      theme={(row.theme ?? {}) as Record<string, never>}
      layout={(row.layout ?? {}) as Record<string, never>}
      variant={variant}
    />
  )
}
