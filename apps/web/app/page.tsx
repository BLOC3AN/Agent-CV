import { getPool, JobRepo } from '@hr/db'
import { profileCompleteness } from '@hr/matching'
import { ProfileSchema } from '@hr/schema'
import { decideHome, nextStepFor, type HomeJob } from '@/lib/home-state'
import { IntentRouter } from '@/components/home/IntentRouter'
import { ResumeHome } from '@/components/home/ResumeHome'
import { ReturningHome, type RecentCv, type RecentMatch } from '@/components/home/ReturningHome'

/**
 * Home — UC-01/02/03, PRODUCT §3.
 *
 * Ba màn hình khác nhau, chọn theo TRẠNG THÁI THẬT của người dùng chứ không
 * theo cookie "đã xem onboarding": cookie nói họ đã NHÌN thấy gì, còn thứ cần
 * biết là họ đang ở ĐÂU trong công việc của mình.
 *
 * Quyết định nằm ở `lib/home-state.ts` để kiểm được cả ba nhánh mà không cần
 * dựng React hay Postgres.
 */

export const dynamic = 'force-dynamic'

interface HomeData {
  jobs: HomeJob[]
  profileCount: number
  cv: RecentCv | null
  profileData: unknown
  matches: RecentMatch[]
  hasAnalysis: boolean
}

/** Chào theo giờ trong ngày — giờ máy chủ, đủ dùng ở giai đoạn này. */
function greet(name: string | null): string {
  const h = new Date().getHours()
  const phan = h < 11 ? 'Chào buổi sáng' : h < 18 ? 'Chào buổi chiều' : 'Chào buổi tối'
  return name ? `${phan}, ${name}` : phan
}

/** "2 giờ trước" — mốc tương đối dễ đọc hơn dấu thời gian đầy đủ. */
function when(d: Date): string {
  const phut = Math.round((Date.now() - d.getTime()) / 60_000)
  if (phut < 1) return 'vừa xong'
  if (phut < 60) return `${phut} phút trước`
  const gio = Math.round(phut / 60)
  if (gio < 24) return `${gio} giờ trước`
  return `${Math.round(gio / 24)} ngày trước`
}

async function load(): Promise<HomeData | null> {
  // Chưa đăng nhập thì hiện Home lần đầu — người lạ vẫn thấy được sản phẩm
  // làm gì trước khi phải đăng ký (BR-01.4).
  const { currentUser } = await import('@/lib/auth')
  const userId = (await currentUser().catch(() => null))?.id
  if (!userId) return null

  const pool = getPool()
  const jobs = await new JobRepo(pool).listByUser(userId, 10).catch(() => [])

  const [cvRows, profRows, matchRows] = await Promise.all([
    pool
      .query<{ id: string; title: string | null; updated_at: Date; data: unknown }>(
        `SELECT c.id, c.title, c.updated_at, p.data
           FROM cv_documents c JOIN profiles p ON p.id = c.profile_id
          WHERE c.user_id = $1
          ORDER BY c.updated_at DESC LIMIT 1`,
        [userId],
      )
      .catch(() => ({ rows: [] })),
    pool
      .query<{ n: string }>('SELECT count(*) AS n FROM profiles WHERE user_id = $1', [userId])
      .catch(() => ({ rows: [{ n: '0' }] })),
    pool
      .query<{ title: string | null; overall: number; cv_id: string }>(
        `SELECT j.title, (m.score->>'overall')::int AS overall, m.cv_id
           FROM match_analyses m
           JOIN cv_documents c ON c.id = m.cv_id
           LEFT JOIN job_descriptions j ON j.id = m.jd_id
          WHERE c.user_id = $1
          ORDER BY m.created_at DESC LIMIT 3`,
        [userId],
      )
      .catch(() => ({ rows: [] })),
  ])

  const cvRow = cvRows.rows[0]
  return {
    jobs: jobs.map((j) => ({
      id: j.id,
      kind: j.kind,
      status: j.status,
      createdAt: j.createdAt,
      filename: typeof j.payload['filename'] === 'string' ? j.payload['filename'] : undefined,
      // Job xong mà chưa có `profileId` trong kết quả nghĩa là chưa rà soát
      reviewed: j.status === 'done' ? Boolean(j.result?.['profileId']) : undefined,
    })),
    profileCount: Number(profRows.rows[0]?.n ?? 0),
    cv: cvRow
      ? { id: cvRow.id, title: cvRow.title ?? 'CV của tôi', updatedAt: when(cvRow.updated_at) }
      : null,
    profileData: cvRow?.data ?? null,
    matches: matchRows.rows.map((r) => ({
      jdTitle: r.title ?? 'Tin tuyển dụng',
      overall: r.overall,
      cvId: r.cv_id,
    })),
    hasAnalysis: matchRows.rows.length > 0,
  }
}

export default async function Home() {
  const data = await load()
  if (!data) return <IntentRouter />

  const decision = decideHome({
    profileCount: data.profileCount,
    jobs: data.jobs,
    now: new Date(),
  })

  if (decision.kind === 'resume' && decision.job) return <ResumeHome job={decision.job} />
  if (decision.kind === 'first_time') return <IntentRouter />

  // Hồ sơ hỏng thì đừng làm vỡ Home — thà hiện bộ định tuyến còn hơn trang trắng
  const parsed = ProfileSchema.safeParse(data.profileData)
  if (!parsed.success) return <IntentRouter />

  return (
    <ReturningHome
      greeting={greet(null)}
      completeness={profileCompleteness(parsed.data)}
      cv={data.cv}
      nextStep={nextStepFor(profileCompleteness(parsed.data), {
        cvId: data.cv?.id ?? null,
        hasAnalysis: data.hasAnalysis,
      })}
      matches={data.matches}
    />
  )
}
