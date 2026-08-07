import type { Metadata } from 'next'
import './globals.css'
import { TopNav } from '@/components/nav/TopNav'
import { DegradeBanner } from '@/components/system/DegradeBanner'

export const metadata: Metadata = {
  title: 'HR-Agent — Trợ lý viết CV',
  description: 'Đối chiếu CV với JD và nhận tư vấn từ kinh nghiệm HR thật.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body className="bg-neutral-50 text-neutral-900">
        <DegradeBanner />
        <TopNav />
        {children}
      </body>
    </html>
  )
}
