import { describe, it, expect, vi } from 'vitest'
import { ProfileSchema, type PatchOp, type Profile } from '@hr/schema'
import { validateOps, runChatTurn, type ChatFlowDeps } from '../src/chat-flow.js'
import type { Gateway } from '../src/gateway.js'

/**
 * Test tầng điều phối chat — TDD §8.3, UC-51/52/53.
 *
 * Trọng tâm là `validateOps`: đây là chốt chặn giữa model và hồ sơ người dùng.
 * Model 4B sẽ trả về op trỏ vào đường dẫn không có thật và dẫn nguồn sai —
 * lọt qua đây thì user thấy một đề xuất trông đáng tin và tick nhầm.
 */

function profile(over: Partial<Profile> = {}): Profile {
  return ProfileSchema.parse({
    schemaVersion: 1,
    language: 'vi',
    basics: { name: 'Nguyễn Văn A' },
    work: [{ org: 'Cty X', role: 'Dev', highlights: ['Xây dựng API'] }],
    ...over,
  })
}

function op(over: Partial<PatchOp> = {}): PatchOp {
  return {
    op: 'replace',
    path: '/work/0/role',
    value: 'Backend Developer',
    rationale: 'Chức danh cụ thể hơn giúp nhà tuyển dụng hình dung vai trò',
    grounding: { type: 'existing_field', ref: '/work/0/role' },
    kbRefs: [],
    ...over,
  } as PatchOp
}

const MSG_IDS = new Set(['msg-1', 'msg-2'])

describe('validateOps — đường dẫn', () => {
  it('nhận đường dẫn có thật', () => {
    const { valid, rejected } = validateOps([op()], profile(), MSG_IDS)
    expect(valid).toHaveLength(1)
    expect(rejected).toHaveLength(0)
  })

  it('CHẶN chỉ số vượt mảng', () => {
    // User không có cách nào biết `/work/7` là chỉ số vượt mảng
    const { valid, rejected } = validateOps([op({ path: '/work/7/role' })], profile(), MSG_IDS)
    expect(valid).toHaveLength(0)
    expect(rejected[0]!.reason).toMatch(/không có trong hồ sơ/)
  })

  it('CHẶN field bịa ra', () => {
    const { rejected } = validateOps([op({ path: '/work/0/salary' })], profile(), MSG_IDS)
    expect(rejected).toHaveLength(1)
  })

  it('cho phép `add` vào cuối mảng bằng "/-"', () => {
    const { valid } = validateOps(
      [op({ op: 'add', path: '/work/-', value: { org: 'Y', role: 'Dev', highlights: [] } })],
      profile(),
      MSG_IDS,
    )
    expect(valid).toHaveLength(1)
  })

  it('"/-" chỉ hợp lệ với `add`, không phải `replace`', () => {
    const { rejected } = validateOps([op({ op: 'replace', path: '/work/-' })], profile(), MSG_IDS)
    expect(rejected).toHaveLength(1)
  })

  it('cho phép `add` field chưa có', () => {
    const { valid } = validateOps(
      [op({ op: 'add', path: '/basics/headline', value: 'Backend Developer' })],
      profile(),
      MSG_IDS,
    )
    expect(valid).toHaveLength(1)
  })

  it('CHẶN `replace` lên field chưa tồn tại', () => {
    // RFC 6902: replace đòi đường dẫn phải có sẵn
    const { rejected } = validateOps(
      [op({ op: 'replace', path: '/basics/headline' })],
      profile(),
      MSG_IDS,
    )
    expect(rejected).toHaveLength(1)
  })

  it('cho phép `add` thêm phần tử ngay sau cuối mảng', () => {
    const { valid } = validateOps(
      [op({ op: 'add', path: '/work/1', value: { org: 'Y', role: 'Dev', highlights: [] } })],
      profile(),
      MSG_IDS,
    )
    expect(valid).toHaveLength(1)
  })

  it('đường dẫn rỗng bị chặn', () => {
    const { rejected } = validateOps([op({ path: '' })], profile(), MSG_IDS)
    expect(rejected).toHaveLength(1)
  })
})

describe('validateOps — dẫn nguồn (BR-53.2)', () => {
  it('CHẶN op dẫn nguồn tới tin nhắn KHÔNG có thật', () => {
    // Nguy hiểm hơn cả bịa nội dung: giao diện sẽ TICK SẴN op đó vì nó "có
    // nguồn từ người dùng"
    const { valid, rejected } = validateOps(
      [op({ grounding: { type: 'user_message', ref: 'msg-bia-ra' } })],
      profile(),
      MSG_IDS,
    )
    expect(valid).toHaveLength(0)
    expect(rejected[0]!.reason).toMatch(/không tồn tại/)
  })

  it('nhận op dẫn nguồn tới tin nhắn có thật', () => {
    const { valid } = validateOps(
      [op({ grounding: { type: 'user_message', ref: 'msg-1' } })],
      profile(),
      MSG_IDS,
    )
    expect(valid).toHaveLength(1)
  })

  it('CHẶN dẫn nguồn `existing_field` tới field không có', () => {
    const { rejected } = validateOps(
      [op({ grounding: { type: 'existing_field', ref: '/work/9/role' } })],
      profile(),
      MSG_IDS,
    )
    expect(rejected).toHaveLength(1)
  })

  it('`inference` và `kb` được qua — giao diện sẽ cảnh báo riêng', () => {
    const { valid } = validateOps(
      [
        op({ grounding: { type: 'inference', ref: 'suy-luan' } }),
        op({ path: '/work/0/org', grounding: { type: 'kb', ref: 'kb-123' } }),
      ],
      profile(),
      MSG_IDS,
    )
    expect(valid).toHaveLength(2)
  })
})

describe('validateOps — lọc từng op, không bỏ cả lô', () => {
  it('op hỏng bị loại riêng, op tốt vẫn qua', () => {
    // Bỏ cả lô vì một op hỏng sẽ khiến user mất hết đề xuất đúng (UC-53 6a)
    const { valid, rejected } = validateOps(
      [op(), op({ path: '/work/9/role' }), op({ path: '/work/0/highlights/0' })],
      profile(),
      MSG_IDS,
    )
    expect(valid).toHaveLength(2)
    expect(rejected).toHaveLength(1)
  })

  it('mỗi op bị loại đều nói RÕ LÝ DO', () => {
    const { rejected } = validateOps([op({ path: '/khong/co' })], profile(), MSG_IDS)
    expect(rejected[0]!.reason.length).toBeGreaterThan(10)
  })
})

// ── runChatTurn ────────────────────────────────────────────────────────────

function fakeGateway(handlers: Record<string, unknown>): Gateway {
  return {
    run: vi.fn(async (task: { name: string }) => {
      const r = handlers[task.name]
      if (r === undefined) {
        return { ok: false as const, error: { code: 'UNKNOWN' }, meta: {} as never }
      }
      if (r instanceof Error) {
        return { ok: false as const, error: { code: 'TIMEOUT' }, meta: {} as never }
      }
      return { ok: true as const, data: r, meta: {} as never }
    }),
  } as unknown as Gateway
}

const deps = (g: Gateway): ChatFlowDeps => ({ gateway: g, messageIds: MSG_IDS })

describe('runChatTurn', () => {
  it('người dùng chỉ HỎI → trả lời, KHÔNG sinh patch', async () => {
    const g = fakeGateway({
      plan_agent_step: { intent: 'ask_question', targetPath: null, needsInfo: [] },
    })
    const r = await runChatTurn(deps(g), {
      message: 'CV của em ổn chưa ạ?',
      profile: profile(),
      history: [],
    })
    expect(r.kind).toBe('reply')
    // Không gọi propose_patch cho một câu hỏi
    expect(g.run).toHaveBeenCalledTimes(1)
  })

  it('thiếu thông tin → HỎI LẠI, không bịa (BR-52.1)', async () => {
    const g = fakeGateway({
      plan_agent_step: {
        intent: 'add_content',
        targetPath: '/work/0',
        needsInfo: ['Dự án phục vụ bao nhiêu người dùng?'],
      },
      insight_mining: {
        reason: 'Cần con số để bullet có sức thuyết phục',
        targetPath: '/work/0',
        questions: [{ id: 'q1', question: 'Hệ thống phục vụ bao nhiêu người dùng?' }],
      },
    })
    const r = await runChatTurn(deps(g), {
      message: 'Thêm thành tích cho mục kinh nghiệm',
      profile: profile(),
      history: [],
    })

    expect(r.kind).toBe('clarify')
    // KHÔNG được gọi propose_patch khi chưa có câu trả lời
    expect(g.run).toHaveBeenCalledTimes(2)
  })

  it('đã có câu trả lời → BỎ QUA bước hỏi, đề xuất luôn', async () => {
    const g = fakeGateway({
      plan_agent_step: {
        intent: 'add_content',
        targetPath: '/work/0',
        needsInfo: ['bao nhiêu người dùng'],
      },
      propose_patch: { ops: [op({ grounding: { type: 'user_message', ref: 'msg-1' } })], summary: 'x' },
    })
    const r = await runChatTurn(deps(g), {
      message: 'Thêm thành tích',
      profile: profile(),
      history: [],
      answers: [{ messageId: 'msg-1', question: 'Bao nhiêu người dùng?', answer: '10.000' }],
    })
    expect(r.kind).toBe('patch')
  })

  it('làm gọn câu chữ → KHÔNG hỏi gì, đề xuất luôn', async () => {
    const g = fakeGateway({
      plan_agent_step: { intent: 'rewrite_section', targetPath: '/work', needsInfo: [] },
      propose_patch: { ops: [op()], summary: 'Làm gọn mục kinh nghiệm' },
    })
    const r = await runChatTurn(deps(g), {
      message: 'Làm gọn mục kinh nghiệm giúp em',
      profile: profile(),
      history: [],
    })

    expect(r.kind).toBe('patch')
    if (r.kind === 'patch') expect(r.proposal.summary).toContain('gọn')
  })

  it('op hỏng bị lọc, phần còn lại vẫn tới tay user', async () => {
    const g = fakeGateway({
      plan_agent_step: { intent: 'rewrite_section', targetPath: '/work', needsInfo: [] },
      propose_patch: {
        ops: [op(), op({ path: '/work/99/role' })],
        summary: 'x',
      },
    })
    const r = await runChatTurn(deps(g), {
      message: 'sửa giúp em',
      profile: profile(),
      history: [],
    })

    expect(r.kind).toBe('patch')
    if (r.kind === 'patch') {
      expect(r.proposal.ops).toHaveLength(1)
      expect(r.rejected).toHaveLength(1)
    }
  })

  it('KHÔNG op nào hợp lệ → báo lỗi có ích, không đưa danh sách rỗng', async () => {
    const g = fakeGateway({
      plan_agent_step: { intent: 'rewrite_section', targetPath: '/work', needsInfo: [] },
      propose_patch: { ops: [op({ path: '/khong/ton/tai' })], summary: 'x' },
    })
    const r = await runChatTurn(deps(g), {
      message: 'sửa giúp em',
      profile: profile(),
      history: [],
    })

    expect(r.kind).toBe('error')
    if (r.kind === 'error') {
      expect(r.code).toBe('NO_VALID_OPS')
      // Thông điệp phải gợi ý hành động tiếp theo (BR-71.1)
      expect(r.message).toMatch(/mục nào/)
    }
  })

  it('model chết ở bước hiểu ý định → lỗi thân thiện, không lộ mã kỹ thuật', async () => {
    const g = fakeGateway({ plan_agent_step: new Error('timeout') })
    const r = await runChatTurn(deps(g), {
      message: 'sửa giúp em',
      profile: profile(),
      history: [],
    })

    expect(r.kind).toBe('error')
    if (r.kind === 'error') expect(r.message).not.toMatch(/TIMEOUT|undefined|null/)
  })

  it('soạn câu hỏi hỏng → vẫn đi tiếp, không bỏ mặc người dùng', async () => {
    const g = fakeGateway({
      plan_agent_step: { intent: 'add_content', targetPath: '/work/0', needsInfo: ['x'] },
      insight_mining: new Error('timeout'),
      propose_patch: { ops: [op({ grounding: { type: 'inference', ref: 'suy' } })], summary: 'x' },
    })
    const r = await runChatTurn(deps(g), {
      message: 'thêm thành tích',
      profile: profile(),
      history: [],
    })
    expect(r.kind).toBe('patch')
  })

  it('PII KHÔNG lọt vào prompt', async () => {
    const g = fakeGateway({
      plan_agent_step: { intent: 'rewrite_section', targetPath: '/work', needsInfo: [] },
      propose_patch: { ops: [op()], summary: 'x' },
    })
    const p = profile({
      basics: { name: 'Nguyễn Văn A', email: 'a@b.com', phone: '0901234567', links: [] },
    })
    await runChatTurn(deps(g), { message: 'sửa giúp em', profile: p, history: [] })

    const calls = (g.run as unknown as { mock: { calls: unknown[][] } }).mock.calls
    for (const [, input] of calls) {
      const json = JSON.stringify(input)
      expect(json).not.toContain('a@b.com')
      expect(json).not.toContain('0901234567')
      expect(json).not.toContain('Nguyễn Văn A')
    }
  })
})
