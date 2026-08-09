import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getPool } from '@hr/db'
import { currentUser } from '@/lib/auth'
import { CvDeleteButton } from '@/components/cv/CvDeleteButton'

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
    // Tên tin tuyển dụng nằm trong `requirements`, không phải cột riêng —
    // `job_descriptions` không có cột `title`.
    `SELECT c.id, c.title, c.updated_at, j.requirements->>'title' AS jd_title
       FROM cv_documents c
       LEFT JOIN job_descriptions j ON j.id = c.jd_id
      WHERE c.user_id = $1
      ORDER BY c.updated_at DESC`,
    [user.id],
  )

  return (
    <main className="frontend-new-page animate-fade-in">
      <div className="reference-page-hero flex flex-wrap items-center gap-3 p-6 md:p-8">
        <div className="min-w-0 flex-1">
          <p className="reference-eyebrow">Kho hồ sơ cá nhân</p>
          <h1 className="mt-2 text-2xl font-bold text-white">Danh sách CV của tôi</h1>
          <p className="mt-1 text-sm text-slate-300">Quản lý, chỉnh sửa và tiếp tục hoàn thiện các phiên bản CV.</p>
        </div>
        <span className="flex-1" />
        <Link
          href="/import"
          className="rounded-lg border border-border-strong px-3 py-1.5 text-sm "
        >
          Tải CV lên
        </Link>
        <Link
          href="/cv/new"
          className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white"
        >
          Nhập tay
        </Link>
      </div>

      {rows.length === 0 ? (
        // Danh sách rỗng phải MỜI LÀM GÌ ĐÓ, không chỉ nói "chưa có gì"
        <div className="mt-8 rounded-xl border border-dashed border-border-strong p-8 text-center ">
          <p className="text-ink-muted ">Bạn chưa có CV nào.</p>
          <p className="mt-1 text-sm text-ink-muted">
            Tải một file PDF lên, hoặc nhập tay nếu bạn chưa có CV.
          </p>
        </div>
      ) : (
        <ul className="reference-surface mt-6 divide-y divide-border overflow-hidden">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-3">
              <Link
                href={`/builder/${r.id}`}
                className="min-w-0 flex-1 hover:text-brand"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{r.title ?? 'CV của tôi'}</p>
                  <p className="text-sm text-ink-muted">
                    {/* Bản gắn với một tin tuyển dụng phải nói rõ là tin nào */}
                    {r.jd_title ? `Cho tin: ${r.jd_title} · ` : ''}
                    Sửa {when(r.updated_at)}
                  </p>
                </div>
              </Link>
              <CvDeleteButton cvId={r.id} title={r.title ?? 'CV của tôi'} />
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
