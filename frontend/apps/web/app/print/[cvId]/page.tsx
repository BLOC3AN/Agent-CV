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
    profile: unknown
    template_id: string
    theme: unknown
    layout: unknown
  }>(
    `SELECT p.data AS profile, c.template_id, c.theme, c.layout
     FROM cv_documents c
     JOIN profiles p ON p.id = c.profile_id
     WHERE c.id = $1`,
    [cvId],
  )
  if (rows.length === 0) notFound()

  const row = rows[0]!
  const profile = ProfileSchema.parse(row.profile)
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
