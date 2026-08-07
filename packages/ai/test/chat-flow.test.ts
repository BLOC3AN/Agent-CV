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

describe('validateOps — op phải ĐẦY ĐỦ theo RFC 6902', () => {
  it('CHẶN `replace` thiếu giá trị mới', () => {
    // Lỗi thật gặp phải: schema cho qua (vì `remove` không có value), op chạy
    // thẳng lên modal, user tick, bấm Áp dụng, rồi mới vỡ ở tầng DB với
    // "Patch thất bại: op replace thiếu value"
    const bad = { ...op(), value: undefined }
    const { valid, rejected } = validateOps([bad], profile(), MSG_IDS)

    expect(valid).toHaveLength(0)
    expect(rejected[0]!.reason).toMatch(/thiếu giá trị/)
  })

  it('CHẶN `add` thiếu giá trị mới', () => {
    const bad = { ...op({ op: 'add', path: '/basics/headline' }), value: undefined }
    expect(validateOps([bad], profile(), MSG_IDS).rejected).toHaveLength(1)
  })

  it('`remove` KHÔNG cần giá trị', () => {
    const rm = { ...op({ op: 'remove', path: '/work/0/role' }), value: undefined }
    expect(validateOps([rm], profile(), MSG_IDS).valid).toHaveLength(1)
  })

  it('CHẶN `move` thiếu đường dẫn nguồn', () => {
    const bad = op({ op: 'move', path: '/work/0/org' })
    expect(validateOps([bad], profile(), MSG_IDS).rejected[0]!.reason).toMatch(/nguồn/)
  })

  it('CHẶN `move` có nguồn KHÔNG tồn tại', () => {
    const bad = op({ op: 'move', path: '/work/0/org', from: '/work/9/org' })
    expect(validateOps([bad], profile(), MSG_IDS).rejected).toHaveLength(1)
  })

  it('`move` hợp lệ được qua', () => {
    const ok = op({ op: 'move', path: '/work/0/org', from: '/work/0/role' })
    expect(validateOps([ok], profile(), MSG_IDS).valid).toHaveLength(1)
  })

  it('giá trị RỖNG khác với THIẾU giá trị', () => {
    // Xoá nội dung một dòng là thao tác hợp lệ
    const empty = op({ value: '' })
    expect(validateOps([empty], profile(), MSG_IDS).valid).toHaveLength(1)
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

describe('validateOps — số liệu chỉ được đến từ hồ sơ hoặc người dùng (BR-52.1)', () => {
  const cv = profile({
    work: [
      {
        org: 'Cty X',
        role: 'Dev',
        highlights: ['Giảm thời gian phản hồi từ 800ms xuống 120ms'],
      },
    ],
  })

  it('số BỊA gán nguồn `existing_field` bị HẠ xuống `inference`', () => {
    // Lỗ hổng thật: kiểm đường dẫn thôi là chưa đủ. Model bịa "30%" rồi trỏ vào
    // một bullet CÓ THẬT — đường dẫn hợp lệ, guard cho qua, giao diện TICK SẴN.
    const { valid } = validateOps(
      [
        op({
          path: '/work/0/highlights/0',
          value: 'Tối ưu hệ thống, giảm 30% thời gian xử lý',
          grounding: { type: 'existing_field', ref: '/work/0/highlights/0' },
        }),
      ],
      cv,
      MSG_IDS,
    )

    expect(valid).toHaveLength(1)
    expect(valid[0]!.grounding.type, 'số bịa vẫn được coi là có nguồn').toBe('inference')
    expect(valid[0]!.rationale).toMatch(/chưa có trong hồ sơ/)
  })

  it('số CÓ THẬT trong hồ sơ thì giữ nguyên nguồn', () => {
    const { valid } = validateOps(
      [
        op({
          path: '/work/0/highlights/0',
          value: 'Giảm thời gian phản hồi từ 800ms xuống 120ms bằng bộ nhớ đệm',
          grounding: { type: 'existing_field', ref: '/work/0/highlights/0' },
        }),
      ],
      cv,
      MSG_IDS,
    )
    expect(valid[0]!.grounding.type).toBe('existing_field')
  })

  it('số từ CÂU TRẢ LỜI của người dùng được chấp nhận', () => {
    const { valid } = validateOps(
      [
        op({
          path: '/work/0/highlights/0',
          value: 'Xây dựng hệ thống phục vụ 10.000 người dùng',
          grounding: { type: 'user_message', ref: 'msg-1' },
        }),
      ],
      cv,
      MSG_IDS,
      [{ answer: 'Hệ thống có khoảng 10.000 người dùng' }],
    )
    expect(valid[0]!.grounding.type).toBe('user_message')
  })

  it('KHÔNG loại hẳn op có số bịa — lời khuyên vẫn có thể hữu ích', () => {
    // Loại hẳn sẽ làm mất cả phần diễn đạt tốt; hạ nguồn để user tự quyết
    const { valid, rejected } = validateOps(
      [
        op({
          path: '/work/0/highlights/0',
          value: 'Cải thiện hiệu năng 45%',
          grounding: { type: 'existing_field', ref: '/work/0/highlights/0' },
        }),
      ],
      cv,
      MSG_IDS,
    )
    expect(valid).toHaveLength(1)
    expect(rejected).toHaveLength(0)
  })

  it('chữ số KHÔNG kèm đơn vị không bị coi là số liệu', () => {
    // "React 18" là tên phiên bản, không phải thành tích
    const { valid } = validateOps(
      [
        op({
          path: '/work/0/highlights/0',
          value: 'Xây dựng giao diện bằng React 18 và TypeScript 5',
          grounding: { type: 'existing_field', ref: '/work/0/highlights/0' },
        }),
      ],
      cv,
      MSG_IDS,
    )
    expect(valid[0]!.grounding.type).toBe('existing_field')
  })
})

describe('validateOps — kiểu giá trị phải khớp chỗ nó thay', () => {
  it('CHẶN thay một CHUỖI bằng OBJECT', () => {
    // Đo thật: model trả path "/work/0/highlights/0" (chuỗi) với
    // value {highlights:[...]} (object). Đường dẫn đúng, value có mặt, guard
    // cũ cho qua — ProfileSchema từ chối ở tầng DB sau khi user bấm Áp dụng.
    const bad = op({
      path: '/work/0/highlights/0',
      value: { highlights: ['a', 'b'] },
    })
    const { valid, rejected } = validateOps([bad], profile(), MSG_IDS)

    expect(valid).toHaveLength(0)
    expect(rejected[0]!.reason).toMatch(/string.*object|object.*string/i)
  })

  it('CHẶN thay một DANH SÁCH bằng chuỗi', () => {
    const bad = op({ path: '/work/0/highlights', value: 'một chuỗi' })
    expect(validateOps([bad], profile(), MSG_IDS).rejected).toHaveLength(1)
  })

  it('cùng kiểu thì qua', () => {
    const ok = op({ path: '/work/0/highlights', value: ['a', 'b'] })
    expect(validateOps([ok], profile(), MSG_IDS).valid).toHaveLength(1)
  })

  it('`add` field MỚI không bị kiểm kiểu — chưa có gì để so', () => {
    const ok = op({ op: 'add', path: '/basics/headline', value: 'Backend Developer' })
    expect(validateOps([ok], profile(), MSG_IDS).valid).toHaveLength(1)
  })
})

describe('lỗi NO_VALID_OPS nói RÕ nguyên nhân', () => {
  it('CV thiếu mục → nói thẳng thiếu mục nào', async () => {
    // Lỗi thật người dùng gặp: gõ "thêm số liệu cho dự án đầu tiên" trên CV
    // KHÔNG CÓ dự án nào, và nhận lại câu "bạn thử nói rõ hơn muốn sửa mục
    // nào" — trách ngược người dùng cho việc họ đã làm đúng.
    const g = fakeGateway({
      plan_agent_step: { intent: 'add_content', targetPath: '/projects', needsInfo: [] },
      propose_patch: {
        ops: [op({ path: '/projects/0/highlights/0', value: 'x' })],
        summary: 's',
      },
    })
    const r = await runChatTurn(deps(g), {
      message: 'Thêm số liệu cho dự án đầu tiên',
      profile: profile(),
      history: [],
    })

    expect(r.kind).toBe('error')
    if (r.kind === 'error') {
      expect(r.message).toMatch(/Dự án/)
      expect(r.message).toMatch(/chưa có/)
      // KHÔNG được trách người dùng
      expect(r.message).not.toMatch(/thử nói rõ hơn muốn sửa mục nào/)
    }
  })

  it('không phải do thiếu mục → nêu lý do đầu tiên', async () => {
    const g = fakeGateway({
      plan_agent_step: { intent: 'rewrite_section', targetPath: '/work', needsInfo: [] },
      propose_patch: {
        ops: [op({ grounding: { type: 'user_message', ref: 'msg-bia' } })],
        summary: 's',
      },
    })
    const r = await runChatTurn(deps(g), {
      message: 'sửa giúp em',
      profile: profile(),
      history: [],
    })
    if (r.kind === 'error') expect(r.message).toMatch(/dẫn nguồn|không tồn tại/i)
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

/** Tên các task đã được gọi, theo thứ tự. */
function calledTasks(g: Gateway): string[] {
  const mock = (g.run as unknown as { mock: { calls: [{ name: string }][] } }).mock
  return mock.calls.map((c) => c[0].name)
}

const ANSWER = {
  answer: 'Mục kinh nghiệm của bạn chưa có con số nào, nên nhà tuyển dụng khó hình dung quy mô.',
  nextSteps: ['Thêm số liệu cho mục kinh nghiệm'],
  kbRefs: [],
}

describe('runChatTurn', () => {
  it('người dùng chỉ HỎI → trả lời, KHÔNG sinh patch', async () => {
    const g = fakeGateway({
      plan_agent_step: { intent: 'ask_question', targetPath: null, needsInfo: [] },
      answer_question: ANSWER,
    })
    const r = await runChatTurn(deps(g), {
      message: 'CV của em ổn chưa ạ?',
      profile: profile(),
      history: [],
    })
    expect(r.kind).toBe('reply')
    // plan + answer, KHÔNG có propose_patch
    expect(g.run).toHaveBeenCalledTimes(2)
    expect(calledTasks(g)).not.toContain('propose_patch')
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
      // Thông điệp phải NÊU LÝ DO CỤ THỂ, không phải câu chung chung (BR-71.1)
      expect(r.message.length).toBeGreaterThan(30)
      expect(r.message).toMatch(/không có trong hồ sơ|chưa dùng được/i)
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

// ── UC-56 · Hỏi trợ lý ─────────────────────────────────────────────────────
//
// Cả nhóm này sinh ra từ một lỗi thật: người dùng gõ "Tôi có insight nào bạn
// giúp tôi lọc ra với", hệ thống phân loại ĐÚNG thành `ask_question`, rồi trả
// về chuỗi rỗng và tầng API điền vào "Mình chưa rõ bạn muốn sửa gì".
//
// Hiểu đúng rồi vứt đi, rồi trách ngược người dùng — tệ hơn cả không phân loại.

describe('runChatTurn — UC-56 hỏi trợ lý', () => {
  it('TC-56-01 `ask_question` được TRẢ LỜI, không rơi vào "chưa rõ bạn muốn sửa gì"', async () => {
    const g = fakeGateway({
      plan_agent_step: { intent: 'ask_question', targetPath: null, needsInfo: [] },
      answer_question: ANSWER,
    })
    const r = await runChatTurn(deps(g), {
      message: 'Tôi có insight nào bạn giúp tôi lọc ra với',
      profile: profile(),
      history: [],
    })

    expect(r.kind).toBe('reply')
    if (r.kind !== 'reply') return
    expect(r.text).toBe(ANSWER.answer)
    // BR-56.1 — câu trả lời KHÔNG được là lời trách người dùng
    expect(r.text).not.toMatch(/chưa rõ bạn muốn sửa gì/i)
    expect(r.text.length).toBeGreaterThan(20)
  })

  it('TC-56-02 `explain` đi cùng đường với `ask_question`', async () => {
    const g = fakeGateway({
      plan_agent_step: { intent: 'explain', targetPath: null, needsInfo: [] },
      answer_question: ANSWER,
    })
    const r = await runChatTurn(deps(g), {
      message: 'Vì sao điểm khớp chỉ có 62?',
      profile: profile(),
      history: [],
    })
    expect(r.kind).toBe('reply')
    expect(calledTasks(g)).toEqual(['plan_agent_step', 'answer_question'])
  })

  it('TC-56-03 lượt hỏi KHÔNG sinh patch (BR-56.4)', async () => {
    const g = fakeGateway({
      plan_agent_step: { intent: 'ask_question', targetPath: '/work', needsInfo: ['số liệu'] },
      answer_question: ANSWER,
      // Có sẵn để test hỏng NẾU luồng lỡ gọi tới
      propose_patch: { ops: [op()], summary: 'không nên xuất hiện' },
      insight_mining: { reason: 'x', targetPath: '/work', questions: [] },
    })
    const r = await runChatTurn(deps(g), {
      message: 'CV của tôi yếu chỗ nào?',
      profile: profile(),
      history: [],
    })

    expect(r.kind).toBe('reply')
    // Kể cả khi `needsInfo` có nội dung: người dùng đang HỎI, không nhờ sửa
    expect(calledTasks(g)).not.toContain('propose_patch')
    expect(calledTasks(g)).not.toContain('insight_mining')
  })

  it('TC-56-04 trả lời kèm việc làm tiếp được', async () => {
    const g = fakeGateway({
      plan_agent_step: { intent: 'ask_question', targetPath: null, needsInfo: [] },
      answer_question: ANSWER,
    })
    const r = await runChatTurn(deps(g), { message: 'hỏi gì đó', profile: profile(), history: [] })

    expect(r.kind).toBe('reply')
    if (r.kind !== 'reply') return
    // Nhận xét mà không kèm việc làm được chỉ khiến người ta lo thêm
    expect(r.nextSteps).toEqual(['Thêm số liệu cho mục kinh nghiệm'])
  })

  it('TC-56-05 kết quả đối chiếu JD đi vào prompt trả lời', async () => {
    const g = fakeGateway({
      plan_agent_step: { intent: 'ask_question', targetPath: null, needsInfo: [] },
      answer_question: ANSWER,
    })
    const analysis = {
      overall: 62,
      breakdown: { skills: 55 },
      matchedCount: 4,
      gaps: [{ requirement: 'Docker', severity: 'high', reason: 'không thấy trong CV' }],
      missingAtsKeywords: ['CI/CD'],
    }
    await runChatTurn(deps(g), {
      message: 'Tôi yếu chỗ nào?',
      profile: profile(),
      history: [],
      analysis,
    })

    const call = (g.run as unknown as { mock: { calls: [unknown, { analysis: unknown }][] } }).mock
      .calls[1]!
    // Thiếu ngữ cảnh này thì câu trả lời chỉ còn chung chung — đúng thứ BR-56.2 cấm
    expect(call[1].analysis).toEqual(analysis)
  })

  it('TC-56-06 chưa đối chiếu JD nào → vẫn trả lời (UC-56 3a)', async () => {
    const g = fakeGateway({
      plan_agent_step: { intent: 'ask_question', targetPath: null, needsInfo: [] },
      answer_question: ANSWER,
    })
    const r = await runChatTurn(deps(g), { message: 'CV ổn chưa?', profile: profile(), history: [] })

    expect(r.kind).toBe('reply')
    const call = (g.run as unknown as { mock: { calls: [unknown, { analysis: unknown }][] } }).mock
      .calls[1]!
    expect(call[1].analysis).toBeNull()
  })

  it('TC-56-07 PII không lọt vào prompt trả lời (BR-56.5)', async () => {
    const g = fakeGateway({
      plan_agent_step: { intent: 'ask_question', targetPath: null, needsInfo: [] },
      answer_question: ANSWER,
    })
    await runChatTurn(deps(g), {
      message: 'CV ổn chưa?',
      profile: profile({
        basics: { name: 'Trần Thị Bích Ngọc', email: 'bichngoc@example.com', phone: '0912345678' },
      } as Partial<Profile>),
      history: [],
    })

    const call = (g.run as unknown as { mock: { calls: [unknown, unknown][] } }).mock.calls[1]!
    const sent = JSON.stringify(call[1])
    expect(sent).not.toContain('Trần Thị Bích Ngọc')
    expect(sent).not.toContain('bichngoc@example.com')
    expect(sent).not.toContain('0912345678')
  })

  it('TC-56-08 model hỏng → thông điệp nêu nguyên nhân, không câu chung chung', async () => {
    const g = fakeGateway({
      plan_agent_step: { intent: 'ask_question', targetPath: null, needsInfo: [] },
      answer_question: new Error('timeout'),
    })
    const r = await runChatTurn(deps(g), { message: 'CV ổn chưa?', profile: profile(), history: [] })

    expect(r.kind).toBe('error')
    if (r.kind !== 'error') return
    expect(r.message).toMatch(/quá tải/)
    expect(r.message).not.toMatch(/chưa rõ bạn muốn sửa gì/i)
  })

  it('báo bước "đang trả lời" cho người đang ngồi chờ', async () => {
    const steps: string[] = []
    const g = fakeGateway({
      plan_agent_step: { intent: 'ask_question', targetPath: null, needsInfo: [] },
      answer_question: ANSWER,
    })
    await runChatTurn(
      { gateway: g, messageIds: MSG_IDS, onStep: (s) => steps.push(s) },
      { message: 'CV ổn chưa?', profile: profile(), history: [] },
    )
    expect(steps).toEqual(['planning', 'answering'])
  })
})
