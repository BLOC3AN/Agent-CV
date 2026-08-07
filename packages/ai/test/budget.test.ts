import { describe, it, expect } from 'vitest'
import {
  CachingTokenCounter,
  fitBudget,
  makeLineTrimmer,
  WORKING_BUDGET,
  PHYSICAL_CTX,
  SLOT_RESERVE,
} from '../src/budget.js'
import { GatewayError, type PromptSection } from '../src/types.js'

/**
 * TC-NF-01 · TC-NF-02 · TC-NF-05 · TC-NF-07 — ngân sách context (TDD §6)
 */

const counter = (tokensPerChar = 1 / 3) =>
  new CachingTokenCounter(async (t) => Math.max(1, Math.ceil(t.length * tokensPerChar)))

function section(
  key: string,
  content: string,
  max: number,
  droppable = false,
  compactor?: PromptSection['compactor'],
): PromptSection {
  return {
    key,
    role: key === 'system' ? 'system' : 'user',
    content,
    max,
    droppable,
    ...(compactor ? { compactor } : {}),
  }
}

describe('Hằng số ngân sách (TDD §6.1)', () => {
  it('ngân sách làm việc = 12.000, đệm slot = 4.384', () => {
    expect(WORKING_BUDGET).toBe(12_000)
    expect(PHYSICAL_CTX).toBe(16_384)
    expect(SLOT_RESERVE).toBe(4_384)
  })
})

describe('TC-NF-01 — không vượt 12.000 token', () => {
  it('prompt vừa ngân sách thì đi qua nguyên vẹn', async () => {
    const s = [section('system', 'x'.repeat(300), 600), section('jd', 'y'.repeat(900), 1_500)]
    const fit = await fitBudget(s, { total: 3_000, reserveForOutput: 900 }, counter())
    expect(fit.promptTokens).toBeLessThanOrEqual(3_000 - 900)
    expect(fit.truncated).toBe(false)
    expect(fit.droppedSections).toEqual([])
  })

  it('tổng prompt luôn ≤ total - reserveForOutput sau khi fit', async () => {
    const s = [
      section('system', 'a'.repeat(600), 300, false, makeLineTrimmer()),
      section('profile', 'b\n'.repeat(3_000), 3_200, false, makeLineTrimmer()),
      section('kb', 'c\n'.repeat(3_000), 2_500, true, makeLineTrimmer()),
      section('history', 'd\n'.repeat(3_000), 2_700, true, makeLineTrimmer()),
    ]
    const fit = await fitBudget(s, { total: 12_000, reserveForOutput: 2_000 }, counter())
    expect(fit.promptTokens).toBeLessThanOrEqual(10_000)
  })
})

describe('TC-NF-02 — nén section', () => {
  it('section vượt max được nén trước khi tính tổng', async () => {
    const s = [section('kb', 'line\n'.repeat(2_000), 100, true, makeLineTrimmer())]
    const fit = await fitBudget(s, { total: 3_000, reserveForOutput: 500 }, counter())
    expect(fit.compactedSections).toContain('kb')
    expect(fit.truncated).toBe(true)
  })
})

describe('TC-NF-05 — chiến lược khi vượt (TDD §6.4)', () => {
  it('bỏ section droppable, ưu tiên thấp trước', async () => {
    // 1/3 token mỗi ký tự → tổng ~11.000 token, vượt limit 10.000
    const s = [
      section('system', 'S'.repeat(1_800), 9_999),
      section('profile', 'P'.repeat(9_600), 9_999),
      section('kb', 'K'.repeat(10_500), 9_999, true),
      section('history', 'H'.repeat(11_100), 9_999, true),
    ]
    const fit = await fitBudget(s, { total: 12_000, reserveForOutput: 2_000 }, counter())
    // history (cuối mảng = ưu tiên thấp nhất) phải bị bỏ trước kb
    expect(fit.droppedSections[0]).toBe('history')
    expect(fit.truncated).toBe(true)
  })

  it('KHÔNG cắt cụt âm thầm: hết cách thì ném BUDGET_EXCEEDED', async () => {
    // Toàn bộ non-droppable, không compactor, vượt xa ngân sách
    const s = [
      section('system', 'S'.repeat(3_000), 9_999),
      section('profile', 'P'.repeat(60_000), 9_999),
    ]
    await expect(
      fitBudget(s, { total: 12_000, reserveForOutput: 2_000 }, counter()),
    ).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' })
  })

  it('lỗi BUDGET_EXCEEDED nêu rõ đã nén/bỏ những gì', async () => {
    const s = [
      section('system', 'S'.repeat(60_000), 9_999),
      section('kb', 'K'.repeat(9_000), 100, true, makeLineTrimmer()),
    ]
    try {
      await fitBudget(s, { total: 12_000, reserveForOutput: 2_000 }, counter())
      expect.unreachable('phải ném lỗi')
    } catch (err) {
      expect(err).toBeInstanceOf(GatewayError)
      expect((err as GatewayError).message).toContain('Đã nén')
      expect((err as GatewayError).message).toContain('Đã bỏ')
    }
  })

  it('reserveForOutput ≥ total là lỗi cấu hình', async () => {
    await expect(
      fitBudget([section('a', 'x', 10)], { total: 1_000, reserveForOutput: 1_000 }, counter()),
    ).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' })
  })
})

describe('TC-NF-07 — thứ tự prefix ổn định (TDD §6.6)', () => {
  it('giữ nguyên thứ tự section, gộp message cùng role liền kề', async () => {
    const s = [
      section('system', 'SYS', 100),
      section('profile', 'PROFILE', 100),
      section('jd', 'JD', 100),
      section('kb', 'KB', 100, true),
      section('question', 'Q', 100),
    ]
    const fit = await fitBudget(s, { total: 3_000, reserveForOutput: 500 }, counter())
    expect(fit.messages[0]?.role).toBe('system')
    expect(fit.messages[0]?.content).toBe('SYS')
    // 4 section user liền kề gộp thành 1 message, thứ tự giữ nguyên
    expect(fit.messages[1]?.content).toBe('PROFILE\n\nJD\n\nKB\n\nQ')
  })

  it('hai lần dựng cùng input cho prefix byte-identical', async () => {
    const build = () => [
      section('system', 'SYS ổn định', 100),
      section('profile', 'PROFILE ổn định', 100),
    ]
    const a = await fitBudget(build(), { total: 3_000, reserveForOutput: 500 }, counter())
    const b = await fitBudget(build(), { total: 3_000, reserveForOutput: 500 }, counter())
    expect(JSON.stringify(a.messages)).toBe(JSON.stringify(b.messages))
  })

  it('section rỗng bị loại, không tạo message trống', async () => {
    const s = [section('system', 'SYS', 100), section('kb', '   ', 100, true)]
    const fit = await fitBudget(s, { total: 3_000, reserveForOutput: 500 }, counter())
    expect(fit.messages).toHaveLength(1)
  })
})

describe('CachingTokenCounter (TDD §6.3)', () => {
  it('cache theo hash nội dung, không gọi lại tokenizer', async () => {
    let calls = 0
    const c = new CachingTokenCounter(async (t) => {
      calls++
      return t.length
    })
    await c.count('Profile JSON không đổi trong session')
    await c.count('Profile JSON không đổi trong session')
    await c.count('Profile JSON không đổi trong session')
    expect(calls).toBe(1)
    expect(c.size).toBe(1)
  })

  it('nội dung khác nhau thì đếm riêng', async () => {
    let calls = 0
    const c = new CachingTokenCounter(async (t) => {
      calls++
      return t.length
    })
    await c.count('a')
    await c.count('b')
    expect(calls).toBe(2)
  })
})
