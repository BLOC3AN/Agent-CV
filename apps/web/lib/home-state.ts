import type { Completeness } from '@hr/matching'

/**
 * Chọn Home nào — UC-01/02/03, PRODUCT §3.1.
 *
 * ── Vì sao tách thành hàm thuần ──
 * Quyết định này là logic nghiệp vụ, không phải chi tiết giao diện. Tách ra thì
 * kiểm được cả ba nhánh mà không cần dựng React, không cần Postgres.
 *
 * Đặc biệt là nhánh "dở dang": người tải CV lên rồi đóng tab giữa màn rà soát
 * đã có `job` nhưng CHƯA có `Profile`. Chiếu Home lần đầu cho họ là xoá sạch
 * công họ vừa bỏ ra. Đây là kiểu lỗi chỉ lộ ra khi có người dùng thật, nên nó
 * phải có test.
 */

export type HomeKind = 'first_time' | 'resume' | 'returning'

export interface HomeJob {
  id: string
  /**
   * Loại job. CHỈ `parse_cv` mới là "việc dở dang" theo nghĩa UC-03.
   *
   * Đo trên máy thật: một job `match_analysis` đã xong (kết quả không có
   * `profileId` nên bị coi là chưa rà soát) làm Home hiện "Hệ thống đang đọc CV
   * của bạn" — cho một việc chẳng liên quan gì tới đọc CV.
   */
  kind: string
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  createdAt: Date
  /** Tên file người dùng đã tải lên — thứ họ nhận ra được */
  filename?: string
  /** Đã tạo hồ sơ chưa: job xong nhưng chưa rà soát thì vẫn là dở dang */
  reviewed?: boolean
}

export interface HomeInput {
  profileCount: number
  /** Các job import của user, mới nhất trước hay sau đều được */
  jobs: HomeJob[]
  now: Date
}

export interface HomeDecision {
  kind: HomeKind
  /** Job cần tiếp tục — chỉ có khi kind === 'resume' */
  job?: HomeJob
}

/**
 * Job cũ hơn mốc này không còn tính là "đang dở" — BR-03.2.
 *
 * Quay lại sau hai ngày thì người dùng đã quên mình từng tải file nào lên;
 * chiếu màn "tiếp tục?" lúc đó gây khó hiểu hơn là giúp.
 */
const RESUME_WINDOW_MS = 24 * 60 * 60 * 1_000

/**
 * Job đang dở: chưa chạy xong, hoặc chạy xong mà chưa rà soát.
 *
 * `hasProfile` đổi cách xử lý job HỎNG. Người CHƯA có hồ sơ nào mà lần import
 * vừa rồi hỏng thì đang mắc kẹt — phải nói cho họ biết hỏng gì và mời làm tiếp
 * (BR-03.1). Nhưng người ĐÃ có hồ sơ thì họ đã đi tiếp rồi: một lần thử hỏng
 * bỏ dở không được phép chặn họ khỏi Home quay lại suốt 24 giờ.
 *
 * Đo thật: một job hỏng còn sót từ lần thử trước làm người dùng có hồ sơ đầy
 * đủ vẫn bị chiếu màn hình lỗi.
 */
function isUnfinished(j: HomeJob, hasProfile: boolean): boolean {
  // Lọc ở ĐÂY chứ không ở chỗ gọi: chỗ gọi quên lọc thì Home nói sai, mà không
  // có gì báo lỗi cả.
  if (j.kind !== 'parse_cv') return false
  if (j.status === 'queued' || j.status === 'running') return true
  if (j.status === 'done' && j.reviewed === false) return true
  return j.status === 'failed' && !hasProfile
}

export function decideHome(input: HomeInput): HomeDecision {
  // Kiểm việc dở dang TRƯỚC — BR-03.1. Người dùng đã bỏ công ra rồi, thứ đó
  // được ưu tiên hơn cả việc họ đã có hồ sơ khác hay chưa.
  const hasProfile = input.profileCount > 0
  const fresh = input.jobs
    .filter((j) => isUnfinished(j, hasProfile))
    .filter((j) => input.now.getTime() - j.createdAt.getTime() < RESUME_WINDOW_MS)
    // Nhiều job dở thì lấy MỚI NHẤT, không liệt kê hết (BR-03.2 / TC-03-03)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

  if (fresh.length > 0) return { kind: 'resume', job: fresh[0]! }
  if (input.profileCount > 0) return { kind: 'returning' }
  return { kind: 'first_time' }
}

// ── Việc nên làm tiếp ───────────────────────────────────────────────────────

export interface NextStep {
  /** Câu người dùng đọc — nói rõ việc, không nói chung chung */
  text: string
  /** Nhãn nút */
  cta: string
  href: string
}

/**
 * MỘT việc nên làm tiếp — BR-02.2.
 *
 * Không phải danh sách: nhiều việc thì không việc nào được làm. Và khi không
 * còn gì đáng làm thì NÓI THẲNG (BR-02.3) — bịa một việc để lấp chỗ trống làm
 * người dùng mất tin vào mọi thứ phía trên nó.
 */
export function nextStepFor(
  completeness: Completeness,
  ctx: { cvId: string | null; hasAnalysis: boolean },
): NextStep | null {
  const gap = completeness.missing[0]
  if (gap && ctx.cvId) {
    return {
      text: gap.todo,
      cta: 'Sửa cùng trợ lý',
      href: `/builder/${ctx.cvId}?focus=${encodeURIComponent(gap.path)}`,
    }
  }

  if (!ctx.hasAnalysis && ctx.cvId) {
    return {
      text: 'Dán một tin tuyển dụng vào để biết CV của bạn còn thiếu gì so với yêu cầu thật.',
      cta: 'Đối chiếu tin tuyển dụng',
      href: `/analyze/${ctx.cvId}`,
    }
  }

  return null
}
