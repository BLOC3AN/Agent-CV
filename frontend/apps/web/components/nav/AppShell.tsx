'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const DASHBOARD_PATHS = ['/cv', '/settings', '/kb', '/diagnose/', '/analyze/']

function cvIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/(?:diagnose|analyze)\/([^/]+)/)
  return match?.[1] ?? null
}

function isDashboardPath(pathname: string): boolean {
  if (pathname === '/cv/new') return false
  return pathname === '/' || DASHBOARD_PATHS.some((path) => pathname.startsWith(path))
}

export function AppShell({
  authenticated,
  defaultCvId,
  children,
}: {
  authenticated: boolean
  defaultCvId: string | null
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const showRail = authenticated && isDashboardPath(pathname)
  const cvId = cvIdFromPath(pathname) ?? defaultCvId
  const assistantHref = cvId ? `/builder/${cvId}?assistant=1` : '/cv'

  if (!showRail) return <>{children}</>

  return (
    <div className="reference-app-shell flex">
      <aside className="reference-sidebar hidden w-60 shrink-0 border-r border-border bg-surface md:block">
        <nav aria-label="Điều hướng ứng dụng" className="sticky top-0 flex flex-col">
          <div className="space-y-1">
            <RailLink href="/" active={pathname === '/'} icon="▣">
              Tổng quan
            </RailLink>
            <RailLink href="/cv" active={pathname.startsWith('/cv')} icon="▤">
              CV của tôi
            </RailLink>
            <RailLink href={cvId ? `/analyze/${cvId}` : '/cv'} active={pathname.startsWith('/analyze/')} icon="◈">
              Đối chiếu việc làm
            </RailLink>
            <RailLink href={assistantHref} active={pathname.startsWith('/builder/')} icon="✦">
              Trợ lý AI
            </RailLink>
          </div>

          <div className="my-5 border-t border-border" />

          <div className="space-y-1">
            <RailLink href={cvId ? `/builder/${cvId}` : '/cv'} active={pathname.startsWith('/builder/')} icon="▧">
              Mẫu CV
            </RailLink>
            <RailLink href="/settings" active={pathname.startsWith('/settings')} icon="⚙">
              Cài đặt
            </RailLink>
          </div>

          <div className="mt-auto rounded-lg border border-brand-border bg-brand-subtle p-4">
            <p className="text-sm font-semibold text-brand-ink">Tiếp tục hoàn thiện CV</p>
            <p className="mt-1 text-xs leading-5 text-ink-muted">
              Tập trung vào một việc tiếp theo để hồ sơ tốt hơn.
            </p>
            <Link
              href={cvId ? `/builder/${cvId}` : '/cv'}
              className="mt-3 inline-flex w-full items-center justify-center rounded-md bg-brand px-3 py-2 text-xs font-medium text-white hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              Mở CV của tôi
            </Link>
          </div>
        </nav>
      </aside>

      <div className="reference-page min-w-0 flex-1">{children}</div>
    </div>
  )
}

function RailLink({
  href,
  active,
  icon,
  children,
}: {
  href: string
  active: boolean
  icon: string
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={[
        'reference-rail-link flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors',
        active
          ? 'bg-brand-subtle font-medium text-brand-ink'
          : 'text-ink-muted hover:bg-canvas hover:text-ink',
      ].join(' ')}
    >
      <span aria-hidden="true" className="w-5 text-center text-base">
        {icon}
      </span>
      {children}
    </Link>
  )
}
