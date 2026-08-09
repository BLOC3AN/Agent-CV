import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { DeleteAccount } from '@/components/settings/DeleteAccount'

/** `/settings` — tài khoản & quyền riêng tư. UC-13. */
export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const user = await currentUser()
  if (!user) redirect('/login')

  return (
    <main className="frontend-new-page animate-fade-in">
      <header className="reference-page-hero p-6 md:p-8">
        <p className="reference-eyebrow">Cấu hình hệ thống</p>
        <h1 className="mt-2 text-2xl font-bold text-white">Cài đặt hệ thống</h1>
        <p className="mt-1 text-sm text-slate-300">Quản lý tài khoản và cấu hình hiển thị ứng dụng.</p>
      </header>

      <section className="reference-surface mt-6 p-6">
        <p className="text-sm text-ink-muted">Email</p>
        <p className="font-medium">{user.email}</p>
      </section>

      <section className="mt-6">
        <form action="/api/auth/logout" method="post">
          <button
            type="submit"
            className="rounded-lg border border-border-strong px-4 py-2 text-sm "
          >
            Đăng xuất
          </button>
        </form>
      </section>

      <DeleteAccount email={user.email} />
    </main>
  )
}
