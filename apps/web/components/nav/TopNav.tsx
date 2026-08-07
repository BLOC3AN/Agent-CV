import Link from 'next/link'

/**
 * Thanh điều hướng — X-1/X-6, spec D2.
 *
 * ── Vì sao top nav chứ không sidebar ──
 * Người dùng thường chỉ có bốn đích. Sidebar 240px cho bốn mục là chỗ bỏ đi,
 * và ở /builder trên laptop 1366×768 nó lấy mất đúng phần mà bản xem trước CV
 * cần (FRONTEND §3.1).
 *
 * ── Nút Trợ lý luôn mang ngữ cảnh ──
 * Spec §5.2: chat không ngữ cảnh cho ra lời khuyên chung chung, đúng thứ
 * BR-56.2 cấm. Chưa có CV thì nút dẫn tới chỗ chọn CV chứ không mở chat rỗng.
 *
 * KHÔNG hiện link tới màn hình chưa tồn tại (BR-01.3).
 */

export function TopNavView({ email, cvId }: { email: string | null; cvId: string | null }) {
  return (
    <header className="border-b border-border bg-surface">
      <nav className="mx-auto flex max-w-5xl items-center gap-5 px-6 py-3 text-[13px]">
        <Link href="/" className="flex items-center gap-2 font-semibold text-ink">
          <span aria-hidden="true" className="h-4 w-1 rounded-full bg-brand" />
          HR-Agent
        </Link>

        {email && (
          <>
            <Link href="/" className="text-ink-muted hover:text-ink">
              Trang chủ
            </Link>
            <Link href="/cv" className="text-ink-muted hover:text-ink">
              CV của tôi
            </Link>
          </>
        )}

        <span className="flex-1" />

        {email ? (
          <>
            <Link
              href={cvId ? `/builder/${cvId}?assistant=1` : '/cv'}
              className="inline-flex items-center gap-1.5 rounded-md border border-brand-border bg-brand-subtle px-3 py-1.5 font-medium text-brand-ink hover:border-brand"
            >
              <span aria-hidden="true">✦</span>
              Trợ lý
            </Link>
            <Link href="/settings" className="max-w-[180px] truncate text-ink-muted hover:text-ink">
              {email}
            </Link>
          </>
        ) : (
          <Link href="/login" className="font-medium text-brand hover:text-brand-hover">
            Đăng nhập
          </Link>
        )}
      </nav>
    </header>
  )
}

export async function TopNav({ cvId = null }: { cvId?: string | null } = {}) {
  // `currentUser` kéo theo `import 'server-only'` — nạp tĩnh ở đầu file sẽ nổ
  // ngay khi test giao diện import module này để lấy `TopNavView` (happy-dom
  // không có điều kiện resolve `react-server`). Nạp động ở đây, chỉ khi
  // `TopNav` thật sự chạy, giữ `TopNavView` import được mà không cần mock.
  const { currentUser } = await import('@/lib/auth')
  const user = await currentUser().catch(() => null)
  return <TopNavView email={user?.email ?? null} cvId={cvId} />
}
