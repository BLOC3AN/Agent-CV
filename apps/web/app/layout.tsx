import type { Metadata } from 'next'
import './globals.css'
import { beVietnamPro } from '@/lib/fonts'
import { TopNav } from '@/components/nav/TopNav'
import { DegradeBanner } from '@/components/system/DegradeBanner'
import { AppShell } from '@/components/nav/AppShell'

export const metadata: Metadata = {
  title: 'HR-Agent — Trợ lý viết CV',
  description: 'Đối chiếu CV với JD và nhận tư vấn từ kinh nghiệm HR thật.',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { currentUser } = await import('@/lib/auth')
  const user = await currentUser().catch(() => null)

  return (
    <html lang="vi" className={beVietnamPro.variable}>
      <body>
        <DegradeBanner />
        <TopNav />
        <AppShell authenticated={Boolean(user)}>{children}</AppShell>
      </body>
    </html>
  )
}
