import { describe, it, expect } from 'vitest'
import { ProfileSchema, type Profile } from '@hr/schema'
import { profileCompleteness } from '@hr/matching'
import { decideHome, nextStepFor, type HomeJob } from '@/lib/home-state'

/**
 * TC-01-01/02, TC-03-01..04, TC-02-05/06 — chọn Home theo TRẠNG THÁI THẬT.
 *
 * Không dùng cookie "đã xem onboarding": cookie nói người dùng đã NHÌN thấy gì,
 * còn thứ cần biết là họ đang ở ĐÂU trong công việc của mình.
 */

const NOW = new Date('2026-08-07T12:00:00Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms)
const HOUR = 3_600_000

const job = (over: Partial<HomeJob> = {}): HomeJob => ({
  id: 'j1',
  kind: 'parse_cv',
  status: 'running',
  createdAt: ago(HOUR),
  filename: 'CV.pdf',
  ...over,
})

const decide = (profileCount: number, jobs: HomeJob[] = []) =>
  decideHome({ profileCount, jobs, now: NOW })

describe('decideHome', () => {
  it('TC-01-01 chưa có gì → Home lần đầu', () => {
    expect(decide(0).kind).toBe('first_time')
  })

  it('TC-01-02 đã có hồ sơ → Home quay lại', () => {
    expect(decide(1).kind).toBe('returning')
  })

  it('TC-03-01 việc dở dang được kiểm TRƯỚC cả hai trạng thái kia', () => {
    // Người tải CV lên rồi đóng tab giữa màn rà soát đã bỏ công ra rồi.
    // Chiếu Home lần đầu cho họ là xoá sạch công đó.
    expect(decide(0, [job({ status: 'running' })]).kind).toBe('resume')
    // Kể cả khi họ ĐÃ có hồ sơ khác — việc đang dở vẫn được ưu tiên
    expect(decide(3, [job({ status: 'queued' })]).kind).toBe('resume')
  })

  it('job xong nhưng CHƯA rà soát vẫn là việc dở', () => {
    // Trạng thái dễ sót nhất: `done` mà chưa có Profile
    expect(decide(0, [job({ status: 'done', reviewed: false })]).kind).toBe('resume')
  })

  it('job xong và đã rà soát thì KHÔNG còn là việc dở', () => {
    expect(decide(1, [job({ status: 'done', reviewed: true })]).kind).toBe('returning')
  })

  it('TC-03-04 job HỎNG khi CHƯA có hồ sơ → nói rõ, không im lặng về màn hình đầu', () => {
    const d = decide(0, [job({ status: 'failed' })])
    expect(d.kind).toBe('resume')
    expect(d.job!.status).toBe('failed')
  })

  it('job HỎNG khi ĐÃ có hồ sơ KHÔNG chặn Home quay lại', () => {
    /*
     * HỒI QUY: đo trên máy thật, một job hỏng còn sót từ lần thử trước làm
     * người dùng có hồ sơ đầy đủ vẫn bị chiếu màn hình lỗi suốt 24 giờ. Họ đã
     * đi tiếp rồi — một lần thử hỏng bỏ dở không được phép giữ họ lại.
     */
    expect(decide(2, [job({ status: 'failed' })]).kind).toBe('returning')
  })

  it('job đang CHẠY vẫn ưu tiên dù đã có hồ sơ — việc đó chưa xong thật', () => {
    expect(decide(2, [job({ status: 'running' })]).kind).toBe('resume')
  })

  it('TC-03-02 job cũ hơn 24 giờ không còn tính là đang dở', () => {
    expect(decide(0, [job({ createdAt: ago(25 * HOUR) })]).kind).toBe('first_time')
    expect(decide(1, [job({ createdAt: ago(25 * HOUR) })]).kind).toBe('returning')
  })

  it('TC-03-03 nhiều job dở → lấy MỚI NHẤT, không liệt kê hết', () => {
    const d = decide(0, [
      job({ id: 'cu', createdAt: ago(10 * HOUR) }),
      job({ id: 'moi', createdAt: ago(1 * HOUR) }),
      job({ id: 'giua', createdAt: ago(5 * HOUR) }),
    ])
    expect(d.job!.id).toBe('moi')
  })

  it('CHỈ job đọc CV mới là "việc dở dang"', () => {
    /*
     * HỒI QUY: đo trên máy thật, một job `match_analysis` đã xong (kết quả
     * không có `profileId` nên bị coi là chưa rà soát) làm Home hiện "Hệ thống
     * đang đọc CV của bạn" — cho một việc chẳng liên quan gì tới đọc CV.
     */
    expect(decide(0, [job({ kind: 'match_analysis', status: 'done', reviewed: false })]).kind).toBe(
      'first_time',
    )
    expect(decide(0, [job({ kind: 'export_pdf', status: 'running' })]).kind).toBe('first_time')
  })

  it('job đã huỷ không kéo người dùng trở lại', () => {
    expect(decide(1, [job({ status: 'cancelled' })]).kind).toBe('returning')
  })
})

// ── việc nên làm tiếp ──────────────────────────────────────────────────────

const p = (over: Partial<Profile> = {}): Profile =>
  ProfileSchema.parse({ schemaVersion: 1, language: 'vi', basics: { name: 'A' }, ...over })

const full = (): Profile =>
  p({
    basics: { name: 'A', email: 'a@example.com', introduce: 'Kỹ sư phần mềm.' },
    work: [{ org: 'ABC', role: 'Dev', highlights: ['Giảm 40% thời gian xử lý'] }],
    education: [{ school: 'X', degree: 'Kỹ sư' }],
    skills: ['a', 'b', 'c', 'd', 'e'].map((n) => ({ name: n })),
  } as never)

describe('nextStepFor', () => {
  it('TC-02-05 trả về MỘT việc, không phải danh sách', () => {
    const s = nextStepFor(profileCompleteness(p()), { cvId: 'cv1', hasAnalysis: false })
    expect(s).not.toBeNull()
    expect(typeof s!.text).toBe('string')
  })

  it('chọn chỗ thiếu NẶNG NHẤT trước', () => {
    const s = nextStepFor(profileCompleteness(p()), { cvId: 'cv1', hasAnalysis: false })
    // Kinh nghiệm/dự án nặng 30% — đáng làm hơn phần 10%
    expect(s!.href).toContain('projects')
    expect(s!.href).toContain('assistant=1')
  })

  it('hồ sơ đủ nhưng chưa đối chiếu JD → mời dán tin tuyển dụng', () => {
    const s = nextStepFor(profileCompleteness(full()), { cvId: 'cv1', hasAnalysis: false })
    expect(s!.href).toBe('/analyze/cv1')
  })

  it('TC-02-06 không còn gì đáng làm → trả null, KHÔNG bịa việc', () => {
    // Bịa một việc để lấp chỗ trống làm người dùng mất tin vào mọi thứ phía trên
    const s = nextStepFor(profileCompleteness(full()), { cvId: 'cv1', hasAnalysis: true })
    expect(s).toBeNull()
  })

  it('chưa có CV nào thì không đề xuất mở trình soạn', () => {
    expect(nextStepFor(profileCompleteness(p()), { cvId: null, hasAnalysis: false })).toBeNull()
  })

  it('việc nào cũng có nơi để tới', () => {
    const s = nextStepFor(profileCompleteness(p()), { cvId: 'cv1', hasAnalysis: false })
    expect(s!.href).toMatch(/^\//)
    expect(s!.cta.length).toBeGreaterThan(3)
  })
})
