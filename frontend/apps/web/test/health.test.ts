import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * `lib/health.ts` — TDD §3.2 A7 ("degrade, đừng sập").
 *
 * Ba đảm bảo của `aiAvailable()`, mỗi cái là một cách để Home KHÔNG phụ thuộc
 * model server: cache (đỡ dội việc ping), timeout (đỡ chờ), lạc quan khi lỗi
 * (đỡ sập). Không test thì cả ba chỉ là ý định — hỏng một cái không có gì đỏ,
 * chỉ có một ngày model server treo và Home treo theo mà không ai hiểu vì sao.
 *
 * `server-only` throw ngay khi import ở Node thường (không có điều kiện
 * resolve `react-server` mà Next.js server bundler mới bật) — mock rỗng để
 * import được `lib/health.ts` trong vitest.
 */
vi.mock('server-only', () => ({}))

// `vi.mock(...)` bị hoist lên đầu file — dùng `vi.hoisted` để tránh tham
// chiếu `healthMock` trước khi nó được gán (TDZ).
const { healthMock } = vi.hoisted(() => ({ healthMock: vi.fn() }))

vi.mock('@hr/ai', () => ({
  Gateway: vi.fn().mockImplementation(() => ({ health: healthMock })),
}))

const { aiAvailable, __resetHealthForTest } = await import('@/lib/health')

describe('aiAvailable — lib/health.ts', () => {
  beforeEach(() => {
    healthMock.mockReset()
    __resetHealthForTest()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('gateway khoẻ → true', async () => {
    healthMock.mockResolvedValue({ healthy: true, models: {}, breakers: {} })
    expect(await aiAvailable()).toBe(true)
  })

  it('gateway không khoẻ → false', async () => {
    healthMock.mockResolvedValue({ healthy: false, models: {}, breakers: {} })
    expect(await aiAvailable()).toBe(false)
  })

  it('cache 30 giây: gọi hai lần liên tiếp chỉ ping gateway một lần', async () => {
    healthMock.mockResolvedValue({ healthy: true, models: {}, breakers: {} })
    await aiAvailable()
    await aiAvailable()
    expect(healthMock).toHaveBeenCalledTimes(1)
  })

  it('gateway ném lỗi → lạc quan trả true, không kéo Home sập theo', async () => {
    healthMock.mockRejectedValue(new Error('model server chết'))
    expect(await aiAvailable()).toBe(true)
  })

  it('quá 1.5 giây → lạc quan trả true, không chờ gateway trả lời', async () => {
    vi.useFakeTimers()
    // Gateway treo vô thời hạn — promise health() không bao giờ resolve.
    healthMock.mockReturnValue(new Promise(() => {}))

    const pending = aiAvailable()
    await vi.advanceTimersByTimeAsync(1_500)

    await expect(pending).resolves.toBe(true)
  })
})
