import Link from 'next/link'
import { currentUser } from '@/lib/auth'

/**
 * Thanh điều hướng — X-1/X-6.
 *
 * Chỉ ba đường: về nhà, danh sách CV, tài khoản. Chưa đăng nhập thì hiện
 * "Đăng nhập" chứ không giấu — người dùng cần biết có tài khoản để lưu lại.
 *
 * KHÔNG hiện link tới màn hình chưa tồn tại (BR-01.3).
 */
export async function TopNav() {
  const user = await currentUser().catch(() => null)

  return (
    <header className="border-b border-neutral-200 dark:border-neutral-800">
      <nav className="mx-auto flex max-w-5xl items-center gap-4 px-6 py-3 text-sm">
        <Link href="/" className="font-semibold">
          HR-Agent
        </Link>
        {user && (
          <Link href="/cv" className="text-neutral-600 hover:text-neutral-900 dark:text-neutral-400">
            CV của tôi
          </Link>
        )}
        <span className="flex-1" />
        {user ? (
          <Link
            href="/settings"
            className="truncate text-neutral-600 hover:text-neutral-900 dark:text-neutral-400"
          >
            {user.email}
          </Link>
        ) : (
          <Link href="/login" className="font-medium text-sky-700 dark:text-sky-400">
            Đăng nhập
          </Link>
        )}
      </nav>
    </header>
  )
}
