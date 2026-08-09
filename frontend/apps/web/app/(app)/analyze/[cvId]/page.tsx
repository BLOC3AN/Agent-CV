import { getPool } from '@hr/db'
import { notFound } from 'next/navigation'
import { ReportView } from '@/components/analyze/ReportView'
import { JdForm } from '@/components/analyze/JdForm'

/**
 * `/analyze/:cvId` — dán JD và xem báo cáo đối chiếu (UC-41, UC-42).
 *
 * Một trang cho cả hai việc: chưa có kết quả thì hiện ô dán JD, có rồi thì
 * hiện báo cáo. Tách hai trang sẽ khiến người dùng phải điều hướng qua lại
 * giữa "nhập" và "xem" cho một việc mà họ coi là một.
 */

export const dynamic = 'force-dynamic'

export default async function AnalyzePage({
  params,
}: {
  params: Promise<{ cvId: string }>
}) {
  const { cvId } = await params

  const { rows } = await getPool().query<{ title: string | null; jd_id: string | null }>(
    'SELECT title, jd_id FROM cv_documents WHERE id = $1',
    [cvId],
  )
  if (rows.length === 0) notFound()

  const hasAnalysis = await getPool()
    .query('SELECT 1 FROM match_analyses WHERE cv_id = $1 LIMIT 1', [cvId])
    .then((r) => r.rowCount! > 0)

  return (
    <main className="frontend-new-page animate-fade-in">
      {hasAnalysis ? (
        <ReportView cvId={cvId} />
      ) : (
        <>
          <header className="reference-page-hero p-6 md:p-8">
            <p className="reference-eyebrow">Đối chiếu thông minh</p>
            <h1 className="mt-2 text-2xl font-bold text-white">Đối chiếu CV với tin tuyển dụng</h1>
            <p className="mt-1 text-sm text-slate-300">
              So sánh CV với mô tả công việc để đánh giá độ tương thích ATS và nhận gợi ý chỉnh sửa.
            </p>
          </header>
          <JdForm cvId={cvId} />
        </>
      )}
    </main>
  )
}
