import { notFound } from 'next/navigation'
import { getPool } from '@hr/db'
import type { Layout, Theme } from '@hr/templates'
import { BuilderShell } from '@/components/editor/BuilderShell'
import { parseStoredProfile } from '@/lib/profile-data'

/**
 * Production-backed redesign route.
 *
 * This is deliberately a Next Server Component, not the standalone Vite
 * reference app: it reads the live profile/CV document and keeps the same
 * auth, database and /api contracts as /builder/:cvId. It is the safe route
 * for visual smoke testing before making the redesign the default route.
 */
export const dynamic = 'force-dynamic'

export default async function BuilderPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ cvId: string }>
  searchParams: Promise<{ assistant?: string; focus?: string }>
}) {
  const { cvId } = await params
  const query = await searchParams
  if (!isUuid(cvId)) notFound()
  const { rows } = await getPool().query<{
    profile_id: string
    profile_data: unknown
    template_id: string
    theme: unknown
    layout: unknown
    title: string | null
  }>(
    `SELECT c.profile_id, p.data AS profile_data, c.template_id,
            c.theme, c.layout, c.title
     FROM cv_documents c
     JOIN profiles p ON p.id = c.profile_id
     WHERE c.id = $1`,
    [cvId],
  )
  if (rows.length === 0) notFound()

  const row = rows[0]!
  return (
    <BuilderShell
      profileId={row.profile_id}
      cvId={cvId}
      initialProfile={parseStoredProfile(row.profile_data)}
      templateId={row.template_id}
      theme={(row.theme ?? {}) as Partial<Theme>}
      layout={(row.layout ?? {}) as Partial<Layout>}
      title={row.title ?? 'CV chưa đặt tên'}
      initialDrawer="chat"
      focusPath={query.focus ?? null}
      startWithCv={!query.assistant}
    />
  )
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
