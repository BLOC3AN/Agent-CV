import { describe, it, expect, vi } from 'vitest'
import { JobError, type JobRepo, type JobRow } from '@hr/db'
import { GatewayError } from '@hr/ai'
import { runJob, isRetryable, errorCode, type JobHandler } from '../src/runner.js'

/**
 * Test cho runner — TDD §12.1.
 *
 * Runner là chỗ dễ sai nhất của tầng job: nó quyết định user thấy "đang chạy",
 * "xong" hay "lỗi". Sai ở đây thì job chạy đúng mà UI báo sai, hoặc job đã huỷ
 * vẫn âm thầm chạy.
 */

function fakeJob(over: Partial<JobRow> = {}): JobRow {
  return {
    id: 'job-1',
    userId: 'user-1',
    kind: 'parse_cv',
    idempotencyKey: 'k1',
    status: 'queued',
    payload: {},
    result: null,
    error: null,
    attempts: 0,
    createdAt: new Date(0),
    startedAt: null,
    finishedAt: null,
    ...over,
  }
}

function fakeRepo(job: JobRow | null, claimed = true) {
  return {
    get: vi.fn(async () => job),
    markRunning: vi.fn(async () => claimed),
    markDone: vi.fn(async () => {}),
    markFailed: vi.fn(async () => {}),
  } as unknown as JobRepo & {
    get: ReturnType<typeof vi.fn>
    markRunning: ReturnType<typeof vi.fn>
    markDone: ReturnType<typeof vi.fn>
    markFailed: ReturnType<typeof vi.fn>
  }
}

const ARGS = { jobId: 'job-1', attempt: 1, maxAttempts: 3, setProgress: async () => {} }

describe('isRetryable', () => {
  it('mặc định KHÔNG retry — lỗi lạ thì đừng đoán là tạm thời', () => {
    expect(isRetryable(new Error('gì đó'))).toBe(false)
    expect(isRetryable('chuỗi')).toBe(false)
    expect(isRetryable(null)).toBe(false)
  })

  it('JobError tự khai báo', () => {
    expect(isRetryable(new JobError('X', 'm', true))).toBe(true)
    expect(isRetryable(new JobError('X', 'm', false))).toBe(false)
  })

  it('lỗi mạng thì retry', () => {
    expect(isRetryable(Object.assign(new Error(), { code: 'ECONNREFUSED' }))).toBe(true)
    expect(isRetryable(Object.assign(new Error(), { code: 'ETIMEDOUT' }))).toBe(true)
  })

  it('GatewayError: chỉ quá tải/timeout mới retry', () => {
    expect(isRetryable(new GatewayError('TIMEOUT', 'quá lâu'))).toBe(true)
    expect(isRetryable(new GatewayError('CIRCUIT_OPEN', 'mạch ngắt'))).toBe(true)
    expect(isRetryable(new GatewayError('MODEL_UNAVAILABLE', 'chết'))).toBe(true)
  })

  it('SCHEMA_INVALID / BUDGET_EXCEEDED / PII_GUARD KHÔNG retry', () => {
    // Thử lại chỉ tiêu thời gian model để nhận về đúng lỗi cũ
    for (const c of ['SCHEMA_INVALID', 'BUDGET_EXCEEDED', 'PII_GUARD'] as const) {
      expect(isRetryable(new GatewayError(c, 'x')), c).toBe(false)
    }
  })
})

describe('errorCode', () => {
  it('lấy được code từ cả hai loại lỗi', () => {
    expect(errorCode(new JobError('NO_TEXT_LAYER', 'x'))).toBe('NO_TEXT_LAYER')
    expect(errorCode(new GatewayError('TIMEOUT', 'x'))).toBe('TIMEOUT')
    expect(errorCode(new Error('x'))).toBe('INTERNAL')
  })
})

describe('runJob', () => {
  const ok: JobHandler = async () => ({ done: true })

  it('đường thành công: running → done', async () => {
    const repo = fakeRepo(fakeJob())
    const out = await runJob({ repo, handlers: { parse_cv: ok } }, ARGS)

    expect(repo.markRunning).toHaveBeenCalledWith('job-1')
    expect(repo.markDone).toHaveBeenCalledWith('job-1', { done: true })
    expect(out).toEqual({ done: true })
  })

  it('job đã huỷ thì KHÔNG chạy handler', async () => {
    // User bấm huỷ lúc job còn xếp hàng — công việc đó không được âm thầm chạy
    const repo = fakeRepo(fakeJob({ status: 'cancelled' }), false)
    const handler = vi.fn(ok)

    const out = await runJob({ repo, handlers: { parse_cv: handler } }, ARGS)

    expect(handler).not.toHaveBeenCalled()
    expect(out).toBeNull()
    expect(repo.markDone).not.toHaveBeenCalled()
  })

  it('lỗi KHÔNG đáng retry: ghi failed và KHÔNG ném lại', async () => {
    // Ném lại sẽ khiến BullMQ thử lại một lỗi đã biết chắc là hỏng
    const repo = fakeRepo(fakeJob())
    const handlers = {
      parse_cv: async () => {
        throw new JobError('NO_TEXT_LAYER', 'ảnh scan')
      },
    }

    await expect(runJob({ repo, handlers }, ARGS)).resolves.toBeNull()
    expect(repo.markFailed).toHaveBeenCalledWith('job-1', expect.any(JobError), false)
  })

  it('lỗi đáng retry và còn lượt: ném lại để BullMQ thử tiếp, giữ trạng thái running', async () => {
    const repo = fakeRepo(fakeJob())
    const handlers = {
      parse_cv: async () => {
        throw new GatewayError('TIMEOUT', 'quá lâu')
      },
    }

    await expect(runJob({ repo, handlers }, ARGS)).rejects.toThrow(GatewayError)
    // willRetry = true → KHÔNG chuyển sang 'failed', tránh UI nhấp nháy
    expect(repo.markFailed).toHaveBeenCalledWith('job-1', expect.any(GatewayError), true)
  })

  it('lỗi đáng retry nhưng HẾT lượt: chốt failed, không ném lại', async () => {
    const repo = fakeRepo(fakeJob())
    const handlers = {
      parse_cv: async () => {
        throw new GatewayError('TIMEOUT', 'quá lâu')
      },
    }

    const out = await runJob({ repo, handlers }, { ...ARGS, attempt: 3, maxAttempts: 3 })

    expect(out).toBeNull()
    expect(repo.markFailed).toHaveBeenCalledWith('job-1', expect.any(GatewayError), false)
  })

  it('không có handler cho kind → failed, không ném', async () => {
    const repo = fakeRepo(fakeJob({ kind: 'match_analysis' }))
    await expect(runJob({ repo, handlers: {} }, ARGS)).resolves.toBeNull()
    expect(repo.markFailed).toHaveBeenCalled()
  })

  it('job không tồn tại → ném để BullMQ ghi nhận bất thường', async () => {
    const repo = fakeRepo(null)
    await expect(runJob({ repo, handlers: { parse_cv: ok } }, ARGS)).rejects.toThrow(/Không tìm thấy/)
  })

  it('progress bị kẹp trong 0..100 và làm tròn', async () => {
    const repo = fakeRepo(fakeJob())
    const seen: unknown[] = []
    const handlers = {
      parse_cv: async (ctx: Parameters<JobHandler>[0]) => {
        await ctx.progress(-5)
        await ctx.progress(33.7, 'giữa chừng')
        await ctx.progress(150)
        return {}
      },
    }

    await runJob({ repo, handlers }, { ...ARGS, setProgress: async (d) => void seen.push(d) })

    expect(seen).toEqual([
      { pct: 0, note: undefined },
      { pct: 34, note: 'giữa chừng' },
      { pct: 100, note: undefined },
    ])
  })

  it('handler biết còn lượt thử hay không', async () => {
    const repo = fakeRepo(fakeJob())
    let saw: boolean | null = null
    const handlers = {
      parse_cv: async (ctx: Parameters<JobHandler>[0]) => {
        saw = ctx.hasMoreAttempts
        return {}
      },
    }

    await runJob({ repo, handlers }, { ...ARGS, attempt: 3, maxAttempts: 3 })
    expect(saw).toBe(false)
  })
})
