import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { DeleteAccount } from '@/components/settings/DeleteAccount'

/** `/settings` — tài khoản & quyền riêng tư. UC-13. */
export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const user = await currentUser()
  if (!user) redirect('/login')

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-semibold">Tài khoản</h1>

      <section className="mt-6 rounded-xl border border-neutral-200 p-4 dark:border-neutral-700">
        <p className="text-sm text-neutral-500">Email</p>
        <p className="font-medium">{user.email}</p>
      </section>

      <section className="mt-6">
        <form action="/api/auth/logout" method="post">
          <button
            type="submit"
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm dark:border-neutral-600"
          >
            Đăng xuất
          </button>
        </form>
      </section>

      <DeleteAccount email={user.email} />
    </main>
  )
}
