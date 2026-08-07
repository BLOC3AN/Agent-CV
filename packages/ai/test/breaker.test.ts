import { describe, it, expect } from 'vitest'
import { CircuitBreaker, BreakerRegistry, Semaphore, withTimeout } from '../src/policies.js'

/**
 * TC-DEG-03 · TC-DEG-04 — circuit breaker (TDD §5.5)
 *
 * Lý do: model server không có SLA và driver NVIDIA đang mismatch. Nếu ai đó
 * restart máy, cụm LLM có thể không lên lại được → app phải ngừng gọi mạng
 * thay vì treo mọi request.
 */

function makeClock(start = 0) {
  let t = start
  return { now: () => t, advance: (ms: number) => (t += ms) }
}

const opts = (now: () => number) => ({
  failureThreshold: 5,
  cooldownMs: 60_000,
  halfOpenProbes: 1,
  now,
})

describe('TC-DEG-03 — breaker mở sau 5 lỗi liên tiếp', () => {
  it('4 lỗi vẫn đóng, lỗi thứ 5 thì mở', () => {
    const c = makeClock()
    const b = new CircuitBreaker('local.reasoner', opts(c.now))
    for (let i = 0; i < 4; i++) b.onFailure()
    expect(b.getState()).toBe('closed')
    expect(b.canPass()).toBe(true)

    b.onFailure()
    expect(b.getState()).toBe('open')
  })

  it('khi mở thì KHÔNG cho request chạm mạng trong 60s', () => {
    const c = makeClock()
    const b = new CircuitBreaker('local.reasoner', opts(c.now))
    for (let i = 0; i < 5; i++) b.onFailure()

    expect(b.canPass()).toBe(false)
    c.advance(59_000)
    expect(b.canPass()).toBe(false)
  })

  it('thành công giữa chừng reset bộ đếm', () => {
    const c = makeClock()
    const b = new CircuitBreaker('local.reasoner', opts(c.now))
    b.onFailure()
    b.onFailure()
    b.onSuccess()
    expect(b.failureCount).toBe(0)
    for (let i = 0; i < 4; i++) b.onFailure()
    expect(b.getState()).toBe('closed')
  })
})

describe('TC-DEG-04 — half-open và phục hồi', () => {
  it('sau 60s chuyển half_open, cho đúng 1 probe', () => {
    const c = makeClock()
    const b = new CircuitBreaker('local.reasoner', opts(c.now))
    for (let i = 0; i < 5; i++) b.onFailure()

    c.advance(60_000)
    expect(b.getState()).toBe('half_open')
    expect(b.canPass()).toBe(true)

    b.markAttempt()
    expect(b.canPass()).toBe(false) // đã dùng hết probe
  })

  it('probe thành công → breaker đóng lại', () => {
    const c = makeClock()
    const b = new CircuitBreaker('local.reasoner', opts(c.now))
    for (let i = 0; i < 5; i++) b.onFailure()
    c.advance(60_000)

    b.markAttempt()
    b.onSuccess()
    expect(b.getState()).toBe('closed')
    expect(b.canPass()).toBe(true)
  })

  it('probe thất bại → mở lại NGAY, không cần đủ 5 lỗi', () => {
    const c = makeClock()
    const b = new CircuitBreaker('local.reasoner', opts(c.now))
    for (let i = 0; i < 5; i++) b.onFailure()
    c.advance(60_000)

    b.markAttempt()
    b.onFailure()
    expect(b.getState()).toBe('open')
    expect(b.canPass()).toBe(false)
  })

  it('sau khi mở lại, phải chờ đủ 60s nữa', () => {
    const c = makeClock()
    const b = new CircuitBreaker('local.reasoner', opts(c.now))
    for (let i = 0; i < 5; i++) b.onFailure()
    c.advance(60_000)
    b.markAttempt()
    b.onFailure()

    c.advance(59_999)
    expect(b.getState()).toBe('open')
    c.advance(1)
    expect(b.getState()).toBe('half_open')
  })
})

describe('BreakerRegistry — mỗi model một breaker độc lập', () => {
  it('reasoner chết không làm classifier ngừng hoạt động', () => {
    const c = makeClock()
    const reg = new BreakerRegistry(opts(c.now))
    for (let i = 0; i < 5; i++) reg.get('local.reasoner').onFailure()

    expect(reg.get('local.reasoner').canPass()).toBe(false)
    expect(reg.get('local.classifier').canPass()).toBe(true)
    expect(reg.snapshot()['local.reasoner']).toBe('open')
  })
})

describe('Semaphore — giới hạn đồng thời trên 1 GPU dùng chung', () => {
  it('không vượt max_concurrency', async () => {
    const s = new Semaphore(2, 10)
    const r1 = await s.acquire()
    const r2 = await s.acquire()
    expect(s.stats.active).toBe(2)

    let third = false
    const p = s.acquire().then((r) => {
      third = true
      return r
    })
    await new Promise((r) => setTimeout(r, 10))
    expect(third).toBe(false) // đang xếp hàng

    r1()
    await p
    expect(third).toBe(true)
    r2()
  })

  it('hàng đợi đầy thì từ chối, không chờ vô hạn', async () => {
    const s = new Semaphore(1, 1)
    await s.acquire()
    void s.acquire() // lấp đầy queue
    await expect(s.acquire()).rejects.toThrow(/Hàng đợi đầy/)
  })
})

describe('TC-DEG-06 — timeout không treo vô hạn', () => {
  it('abort sau timeoutMs', async () => {
    await expect(
      withTimeout(
        (signal) =>
          new Promise((_, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')))
          }),
        50,
      ),
    ).rejects.toThrow(/aborted/)
  })

  it('xong trước timeout thì trả kết quả bình thường', async () => {
    const out = await withTimeout(async () => 'ok', 1_000)
    expect(out).toBe('ok')
  })
})
