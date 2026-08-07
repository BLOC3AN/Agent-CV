import type { Metadata } from 'next'
import './globals.css'
import { beVietnamPro } from '@/lib/fonts'
import { TopNav } from '@/components/nav/TopNav'
import { DegradeBanner } from '@/components/system/DegradeBanner'

export const metadata: Metadata = {
  title: 'HR-Agent — Trợ lý viết CV',
  description: 'Đối chiếu CV với JD và nhận tư vấn từ kinh nghiệm HR thật.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={beVietnamPro.variable}>
      <body>
        <DegradeBanner />
        <TopNav />
        {children}
      </body>
    </html>
  )
}
