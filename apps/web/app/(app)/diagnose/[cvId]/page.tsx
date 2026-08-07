import { notFound, redirect } from 'next/navigation'
import { getPool } from '@hr/db'
import { cvHealth, rubrics } from '@hr/matching'
import { ProfileSchema } from '@hr/schema'
import { currentUser } from '@/lib/auth'
import { HealthReport } from '@/components/diagnose/HealthReport'

/**
 * `/diagnose/:cvId` — UC-04, lối vào "Tôi không biết CV mình dở ở đâu".
 *
 * Chấm bằng `cvHealth()`, tức bằng tiêu chí do HR thật viết trong KB. Không cần
 * tin tuyển dụng: câu hỏi của người dùng ở đây là "CV tôi có ổn không", không
 * phải "tôi có hợp việc này không".
 */
export const dynamic = 'force-dynamic'

export default async function DiagnosePage({ params }: { params: Promise<{ cvId: string }> }) {
  const { cvId } = await params
  const user = await currentUser()
  if (!user) redirect('/login')

  const { rows } = await getPool().query<{ data: unknown; title: string | null }>(
    `SELECT p.data, c.title
       FROM cv_documents c JOIN profiles p ON p.id = c.profile_id
      WHERE c.id = $1 AND c.user_id = $2`,
    [cvId, user.id],
  )
  const row = rows[0]
  if (!row) notFound()

  const parsed = ProfileSchema.safeParse(row.data)
  if (!parsed.success) notFound()

  const health = cvHealth({ profile: parsed.data, rubrics: rubrics() })

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-semibold">
        {health.scored ? `CV của bạn đạt ${health.overall}/100` : 'Xem lại CV của bạn'}
      </h1>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
        Chấm theo tiêu chí của HR trong ngành phần mềm — chưa tính tới một tin
        tuyển dụng cụ thể nào.
      </p>

      <div className="mt-8">
        <HealthReport health={health} cvId={cvId} />
      </div>
    </main>
  )
}
