import type { Metadata } from 'next'
import './globals.css'
import { beVietnamPro } from '@/lib/fonts'
import { TopNav } from '@/components/nav/TopNav'
import { DegradeBanner } from '@/components/system/DegradeBanner'
import { AppShell } from '@/components/nav/AppShell'
import { getPool } from '@hr/db'

export const metadata: Metadata = {
  title: 'HR-Agent — Trợ lý viết CV',
  description: 'Đối chiếu CV với JD và nhận tư vấn từ kinh nghiệm HR thật.',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { currentUser } = await import('@/lib/auth')
  const user = await currentUser().catch(() => null)
  const defaultCvId = user
    ? ((await getPool().query<{ id: string }>(
        `SELECT id FROM cv_documents WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1`,
        [user.id],
      ).catch(() => ({ rows: [] }))).rows[0]?.id ?? null)
    : null

  return (
    <html lang="vi" className={beVietnamPro.variable}>
      <body>
        <DegradeBanner />
        <TopNav cvId={defaultCvId} />
        <AppShell authenticated={Boolean(user)} defaultCvId={defaultCvId}>{children}</AppShell>
      </body>
    </html>
  )
}
