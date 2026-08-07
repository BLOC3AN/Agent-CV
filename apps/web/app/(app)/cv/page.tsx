import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getPool } from '@hr/db'
import { currentUser } from '@/lib/auth'

/**
 * `/cv` — danh sách CV của tôi. UC-31, X-6.
 *
 * Mỗi lần đối chiếu một tin tuyển dụng tạo một bản CV riêng (D12, UC-33), nên
 * danh sách này dài ra nhanh. Ghi rõ bản nào gắn với tin nào, không thì người
 * dùng có năm dòng "CV của tôi" giống hệt nhau.
 */
export const dynamic = 'force-dynamic'

interface Row {
  id: string
  title: string | null
  updated_at: Date
  jd_title: string | null
}

function when(d: Date): string {
  const phut = Math.round((Date.now() - d.getTime()) / 60_000)
  if (phut < 60) return `${Math.max(phut, 1)} phút trước`
  const gio = Math.round(phut / 60)
  if (gio < 24) return `${gio} giờ trước`
  return `${Math.round(gio / 24)} ngày trước`
}

export default async function CvListPage() {
  const user = await currentUser()
  if (!user) redirect('/login')

  const { rows } = await getPool().query<Row>(
    `SELECT c.id, c.title, c.updated_at, j.title AS jd_title
       FROM cv_documents c
       LEFT JOIN job_descriptions j ON j.id = c.jd_id
      WHERE c.user_id = $1
      ORDER BY c.updated_at DESC`,
    [user.id],
  )

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-semibold">CV của tôi</h1>
        <span className="flex-1" />
        <Link
          href="/import"
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-600"
        >
          Tải CV lên
        </Link>
        <Link
          href="/cv/new"
          className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white"
        >
          Nhập tay
        </Link>
      </div>

      {rows.length === 0 ? (
        // Danh sách rỗng phải MỜI LÀM GÌ ĐÓ, không chỉ nói "chưa có gì"
        <div className="mt-8 rounded-xl border border-dashed border-neutral-300 p-8 text-center dark:border-neutral-700">
          <p className="text-neutral-600 dark:text-neutral-400">Bạn chưa có CV nào.</p>
          <p className="mt-1 text-sm text-neutral-500">
            Tải một file PDF lên, hoặc nhập tay nếu bạn chưa có CV.
          </p>
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-neutral-200 rounded-xl border border-neutral-200 dark:divide-neutral-700 dark:border-neutral-700">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                href={`/builder/${r.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-800"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{r.title ?? 'CV của tôi'}</p>
                  <p className="text-sm text-neutral-500">
                    {/* Bản gắn với một tin tuyển dụng phải nói rõ là tin nào */}
                    {r.jd_title ? `Cho tin: ${r.jd_title} · ` : ''}
                    Sửa {when(r.updated_at)}
                  </p>
                </div>
                <span aria-hidden className="text-neutral-400">
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
