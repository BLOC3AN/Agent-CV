/**
 * Circuit breaker + health — TDD §5.5.
 *
 * Lý do tồn tại: model server (100.68.50.41) là dependency NGOÀI, không có SLA,
 * và driver NVIDIA đang mismatch nên nếu ai đó restart thì cụm LLM có thể không
 * lên lại được. Ứng dụng phải degrade, không được sập (TDD §2.1, C4).
 */

export type BreakerState = 'closed' | 'open' | 'half_open'

export interface BreakerOptions {
  failureThreshold: number
  cooldownMs: number
  halfOpenProbes: number
  /** Cho phép inject đồng hồ trong test — KHÔNG dùng Date.now() trực tiếp */
  now?: () => number
}

export class CircuitBreaker {
  private failures = 0
  private openedAt = 0
  private probesInFlight = 0
  private state: BreakerState = 'closed'
  private readonly now: () => number

  constructor(
    public readonly name: string,
    private readonly opts: BreakerOptions,
  ) {
    this.now = opts.now ?? (() => Date.now())
  }

  getState(): BreakerState {
    // open → half_open khi hết cooldown
    if (this.state === 'open' && this.now() - this.openedAt >= this.opts.cooldownMs) {
      this.state = 'half_open'
      this.probesInFlight = 0
    }
    return this.state
  }

  /** Có được phép gửi request không */
  canPass(): boolean {
    const s = this.getState()
    if (s === 'closed') return true
    if (s === 'open') return false
    // half_open: chỉ cho tối đa `halfOpenProbes` request thăm dò
    return this.probesInFlight < this.opts.halfOpenProbes
  }

  markAttempt(): void {
    if (this.getState() === 'half_open') this.probesInFlight++
  }

  onSuccess(): void {
    this.failures = 0
    this.probesInFlight = 0
    this.state = 'closed'
  }

  onFailure(): void {
    const s = this.getState()
    if (s === 'half_open') {
      // Probe thất bại → mở lại ngay, không cần đủ ngưỡng
      this.trip()
      return
    }
    this.failures++
    if (this.failures >= this.opts.failureThreshold) this.trip()
  }

  private trip(): void {
    this.state = 'open'
    this.openedAt = this.now()
    this.probesInFlight = 0
  }

  /** Chỉ dùng trong test */
  reset(): void {
    this.failures = 0
    this.probesInFlight = 0
    this.openedAt = 0
    this.state = 'closed'
  }

  get failureCount(): number {
    return this.failures
  }
}

// ── Registry theo model ─────────────────────────────────────────────────────

export class BreakerRegistry {
  private breakers = new Map<string, CircuitBreaker>()

  constructor(private readonly defaults: BreakerOptions) {}

  get(modelRef: string): CircuitBreaker {
    let b = this.breakers.get(modelRef)
    if (!b) {
      b = new CircuitBreaker(modelRef, this.defaults)
      this.breakers.set(modelRef, b)
    }
    return b
  }

  snapshot(): Record<string, BreakerState> {
    const out: Record<string, BreakerState> = {}
    for (const [k, v] of this.breakers) out[k] = v.getState()
    return out
  }

  resetAll(): void {
    for (const b of this.breakers.values()) b.reset()
  }
}

// ── Giới hạn đồng thời ──────────────────────────────────────────────────────

/**
 * 1 GPU RTX 3060 dùng chung cho 5 model, lại dùng chung máy với 109 container
 * khác (TDD §2.1). Không để hàng đợi vỡ.
 */
export class Semaphore {
  private active = 0
  private queue: (() => void)[] = []

  constructor(
    private readonly maxConcurrency: number,
    private readonly maxQueue: number,
  ) {}

  async acquire(): Promise<() => void> {
    if (this.active < this.maxConcurrency) {
      this.active++
      return () => this.release()
    }
    if (this.queue.length >= this.maxQueue) {
      throw new Error(`Hàng đợi đầy (${this.maxQueue})`)
    }
    await new Promise<void>((resolve) => this.queue.push(resolve))
    this.active++
    return () => this.release()
  }

  private release(): void {
    this.active--
    const next = this.queue.shift()
    if (next) next()
  }

  get stats(): { active: number; queued: number } {
    return { active: this.active, queued: this.queue.length }
  }
}

// ── Timeout & retry ─────────────────────────────────────────────────────────

export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  outer?: AbortSignal,
): Promise<T> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(new Error(`Timeout ${timeoutMs}ms`)), timeoutMs)
  const onOuterAbort = () => ac.abort(outer?.reason)
  outer?.addEventListener('abort', onOuterAbort, { once: true })
  try {
    return await fn(ac.signal)
  } finally {
    clearTimeout(timer)
    outer?.removeEventListener('abort', onOuterAbort)
  }
}
