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

  /** Hồ sơ có hai gạch đầu dòng — xoá/di chuyển một cái không làm vỡ schema. */
  const twoHighlights = () =>
    profile({ work: [{ org: 'Cty X', role: 'Dev', highlights: ['Một', 'Hai'] }] } as never)

  it('`remove` KHÔNG cần giá trị', () => {
    const rm = { ...op({ op: 'remove', path: '/work/0/highlights/1' }), value: undefined }
    expect(validateOps([rm], twoHighlights(), MSG_IDS).valid).toHaveLength(1)
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
    const ok = op({ op: 'move', path: '/work/0/highlights/0', from: '/work/0/highlights/1' })
    expect(validateOps([ok], twoHighlights(), MSG_IDS).valid).toHaveLength(1)
  })

  it('CHẶN `remove` xoá mất field BẮT BUỘC', () => {
    // Xoá `role` thì mục kinh nghiệm không còn là mục kinh nghiệm hợp lệ —
    // ProfileSchema từ chối, nên op phải bị loại TRƯỚC khi hiện lên modal
    const rm = { ...op({ op: 'remove', path: '/work/0/role' }), value: undefined }
    const { valid, rejected } = validateOps([rm], profile(), MSG_IDS)
    expect(valid).toHaveLength(0)
    expect(rejected[0]!.reason).toMatch(/không đúng dạng|áp được/)
  })

  it('giá trị RỖNG khác với THIẾU giá trị', () => {
    // Xoá nội dung một dòng là thao tác hợp lệ
    const empty = op({ value: '' })
    expect(validateOps([empty], profile(), MSG_IDS).valid).toHaveLength(1)
  })
})

describe('validateOps — dẫn nguồn (BR-53.2)', () => {
  it('TC-53-22 dẫn nguồn tới tin nhắn KHÔNG có thật → HẠ xuống `inference`', () => {
    // Nguy hiểm hơn cả bịa nội dung: giao diện TICK SẴN op "có nguồn từ người
    // dùng". Hạ cấp gỡ đúng nguy hiểm đó — không tick sẵn, viền vàng.
    //
    // KHÔNG loại hẳn: đo thật, khi người dùng gõ yêu cầu mới thay vì trả lời
    // form, model gán `user_message` cho MỌI op → cả lô bị loại và người dùng
    // nhận một lời trách về lỗi của model (TDD §8.3.7).
    const { valid, rejected } = validateOps(
      [op({ grounding: { type: 'user_message', ref: 'msg-bia-ra' } })],
      profile(),
      MSG_IDS,
    )
    expect(valid).toHaveLength(1)
    expect(valid[0]!.grounding.type).toBe('inference')
    expect(rejected).toHaveLength(0)
  })

  it('cả lô dẫn nguồn bịa vẫn ra đề xuất dùng được, không phải lỗi', () => {
    const ops = [
      op({ grounding: { type: 'user_message', ref: 'bia-1' } }),
      op({ path: '/work/0/org', grounding: { type: 'user_message', ref: 'bia-2' } }),
    ]
    const { valid } = validateOps(ops, profile(), MSG_IDS)
    expect(valid).toHaveLength(2)
    // Không op nào được tick sẵn — an toàn vẫn giữ nguyên
    expect(valid.every((o) => o.grounding.type === 'inference')).toBe(true)
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
        ops: [op({ path: '/work/0/salary' })],
        summary: 's',
      },
    })
    const r = await runChatTurn(deps(g), {
      message: 'sửa giúp em',
      profile: profile(),
      history: [],
    })
    if (r.kind === 'error') expect(r.message.length).toBeGreaterThan(30)
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

// ── TDD §8.3.6 · ba không gian tên đường dẫn ───────────────────────────────

describe('con trỏ rút gọn không được lọt xuống dưới hay ra ngoài', () => {
  it('TC-53-36 `plan_agent_step` trả `/act` → dịch về `/activities`', async () => {
    const g = fakeGateway({
      plan_agent_step: { intent: 'add_content', targetPath: '/act', needsInfo: ['vai trò'] },
      insight_mining: {
        reason: 'Cần biết vai trò cụ thể',
        targetPath: '/activities',
        questions: [{ id: 'q1', question: 'Bạn làm vai trò gì?' }],
      },
    })
    await runChatTurn(deps(g), {
      message: 'Thêm mục Hoạt động mới',
      profile: profile({ activities: [{ name: 'CLB', highlights: ['a'] }] } as never),
      history: [],
    })

    const call = (
      g.run as unknown as { mock: { calls: [unknown, { targetPath: string; targetContent: string }][] } }
    ).mock.calls[1]!
    // `/act` không tồn tại trong Profile — `readPath` sẽ trả rỗng mà không báo gì
    expect(call[1].targetPath).toBe('/activities')
    expect(call[1].targetContent).not.toBe('')
  })

  it('TC-53-37 câu hỏi làm rõ KHÔNG lộ con trỏ JSON ra màn hình', async () => {
    const g = fakeGateway({
      plan_agent_step: { intent: 'add_content', targetPath: '/act', needsInfo: ['vai trò'] },
      insight_mining: {
        // Model đã viết đúng câu này ra màn hình thật
        reason: 'Để xác định đúng hướng đi cho vị trí /act, cần biết bạn muốn gì.',
        targetPath: '/activities',
        questions: [{ id: 'q1', question: 'Bạn muốn mở rộng dự án cũ hay thêm mới?' }],
      },
    })
    const r = await runChatTurn(deps(g), {
      message: 'Thêm mục Hoạt động mới',
      profile: profile(),
      history: [],
    })

    expect(r.kind).toBe('clarify')
    if (r.kind !== 'clarify') return
    expect(r.request.reason).not.toMatch(/\/act|\/exp|\/work|\/proj/)
    expect(r.request.reason).toContain('Hoạt động')
  })

  it('nhãn tiếng Việt đi vào prompt thay cho con trỏ', async () => {
    const g = fakeGateway({
      plan_agent_step: { intent: 'add_content', targetPath: '/exp/0', needsInfo: ['số liệu'] },
      insight_mining: { reason: 'x', targetPath: '/work/0', questions: [{ id: 'q', question: 'y' }] },
    })
    await runChatTurn(deps(g), { message: 'thêm gì đó', profile: profile(), history: [] })

    const call = (g.run as unknown as { mock: { calls: [unknown, { targetLabel: string }][] } }).mock
      .calls[1]!
    expect(call[1].targetLabel).toBe('Kinh nghiệm')
  })
})

describe('gõ lại y hệt yêu cầu cũ → không hỏi lại nữa', () => {
  it('lần đầu thì HỎI', async () => {
    const g = fakeGateway({
      plan_agent_step: { intent: 'add_content', targetPath: '/act', needsInfo: ['vai trò'] },
      insight_mining: { reason: 'r', targetPath: '/activities', questions: [{ id: 'q', question: 'c' }] },
      propose_patch: { ops: [op()], summary: 's' },
    })
    const r = await runChatTurn(deps(g), {
      message: 'Thêm mục Hoạt động mới',
      profile: profile(),
      history: [{ role: 'user', content: 'Thêm mục Hoạt động mới' }],
    })
    expect(r.kind).toBe('clarify')
  })

  it('lần thứ hai thì ĐỀ XUẤT luôn, không hỏi lại y hệt', async () => {
    const g = fakeGateway({
      plan_agent_step: { intent: 'add_content', targetPath: '/act', needsInfo: ['vai trò'] },
      insight_mining: { reason: 'r', targetPath: '/activities', questions: [{ id: 'q', question: 'c' }] },
      propose_patch: { ops: [op()], summary: 's' },
    })
    const r = await runChatTurn(deps(g), {
      message: 'Thêm mục Hoạt động mới',
      profile: profile(),
      history: [
        { role: 'user', content: 'Thêm mục Hoạt động mới' },
        { role: 'assistant', content: 'r' },
        { role: 'user', content: 'Thêm mục Hoạt động mới' },
      ],
    })

    expect(r.kind).toBe('patch')
    // Gõ lại nguyên văn nghĩa là họ không có gì bổ sung — hỏi tiếp là vòng lặp
    expect(calledTasks(g)).not.toContain('insight_mining')
  })
})

describe('TC-53-39 chốt chặn HÌNH DẠNG — áp thử rồi kiểm bằng ProfileSchema', () => {
  it('CHẶN `add` phần tử sai hình dạng', () => {
    // Model đã trả đúng thứ này trên hồ sơ thật: object kiểu JSON Schema nằm ở
    // chỗ đáng lẽ là chuỗi. Đường dẫn hợp lệ, `value` có mặt — guard cũ cho qua.
    const { valid, rejected } = validateOps(
      [
        op({
          op: 'add',
          path: '/activities/-',
          value: { name: { $ref: '/activities/0/name' }, period: { $ref: '/work/0' } },
        }),
      ],
      profile(),
      MSG_IDS,
    )
    expect(valid).toHaveLength(0)
    expect(rejected[0]!.reason).toMatch(/không đúng dạng/)
  })

  it('CHO QUA `add` phần tử đúng hình dạng', () => {
    const { valid, rejected } = validateOps(
      [
        op({
          op: 'add',
          path: '/activities/-',
          value: { name: 'CLB Tin học', role: 'Trưởng nhóm', highlights: ['Tổ chức workshop'] },
        }),
      ],
      profile(),
      MSG_IDS,
    )
    expect(rejected).toHaveLength(0)
    expect(valid).toHaveLength(1)
  })

  it('CHẶN giá trị sai kiểu ở chỗ đã có sẵn', () => {
    const { valid } = validateOps(
      [op({ path: '/work/0/role', value: { $ref: '/work/0/org' } })],
      profile(),
      MSG_IDS,
    )
    expect(valid).toHaveLength(0)
  })

  it('KHÔNG đụng vào hồ sơ gốc khi áp thử (BR-53.1)', () => {
    const p = profile()
    const before = JSON.stringify(p)
    validateOps(
      [op({ op: 'add', path: '/activities/-', value: { name: 'X', highlights: [] } })],
      p,
      MSG_IDS,
    )
    expect(JSON.stringify(p)).toBe(before)
  })

  it('mỗi op kiểm ĐỘC LẬP — user bỏ tick op nào cũng được', () => {
    // Hai op cùng thêm vào cuối mảng: op thứ hai không được coi là phụ thuộc
    // op thứ nhất, vì người dùng có thể chỉ tick một trong hai
    const add = (n: string) =>
      op({ op: 'add', path: '/activities/-', value: { name: n, highlights: [] } })
    const { valid } = validateOps([add('A'), add('B')], profile(), MSG_IDS)
    expect(valid).toHaveLength(2)
  })
})

describe('không op nào dùng được mà đã bỏ qua bước hỏi → HỎI, không báo lỗi', () => {
  it('quay lại hỏi thay vì trả về ngõ cụt', async () => {
    const g = fakeGateway({
      plan_agent_step: { intent: 'add_content', targetPath: '/act', needsInfo: ['vai trò cụ thể'] },
      // Model trả đúng thứ nó đã trả trên hồ sơ thật
      propose_patch: {
        ops: [op({ op: 'add', path: '/activities/-', value: { name: { $ref: '/activities/0/name' } } })],
        summary: 's',
      },
      insight_mining: {
        reason: 'Cần biết bạn làm vai trò gì',
        targetPath: '/activities',
        questions: [{ id: 'q', question: 'Vai trò của bạn trong dự án là gì?' }],
      },
    })
    const msg = 'Thêm mục Hoạt động mới'
    const r = await runChatTurn(deps(g), {
      message: msg,
      profile: profile(),
      history: [
        { role: 'user', content: msg },
        { role: 'assistant', content: 'r' },
        { role: 'user', content: msg },
      ],
    })

    // Thứ còn thiếu là THÔNG TIN — hỏi vẫn hơn một câu lỗi không lối đi tiếp
    expect(r.kind).toBe('clarify')
  })

  it('người dùng ĐÃ trả lời thì KHÔNG hỏi lại, dù không op nào dùng được', async () => {
    const g = fakeGateway({
      plan_agent_step: { intent: 'add_content', targetPath: '/act', needsInfo: ['vai trò'] },
      propose_patch: { ops: [op({ path: '/khong/ton/tai' })], summary: 's' },
      insight_mining: { reason: 'r', targetPath: '/activities', questions: [{ id: 'q', question: 'c' }] },
    })
    const msg = 'Thêm mục Hoạt động mới'
    const r = await runChatTurn(deps(g), {
      message: msg,
      profile: profile(),
      history: [
        { role: 'user', content: msg },
        { role: 'assistant', content: 'r' },
        { role: 'user', content: msg },
      ],
      answers: [{ messageId: 'msg-1', question: 'Vai trò?', answer: 'Trưởng nhóm 4 người' }],
    })

    // Vừa điền form xong mà lại nhận thêm form nữa thì công họ bỏ ra thành vô ích
    expect(r.kind).not.toBe('clarify')
    expect(calledTasks(g)).not.toContain('insight_mining')
  })
})

describe('không op nào dùng được → nói cho model biết SAI Ở ĐÂU rồi thử lại', () => {
  /** Gateway trả kết quả KHÁC NHAU cho lần gọi thứ nhất và thứ hai của cùng task. */
  function twoShot(first: unknown, second: unknown): Gateway {
    const seen: Record<string, number> = {}
    return {
      run: vi.fn(async (task: { name: string }, input: unknown) => {
        void input
        seen[task.name] = (seen[task.name] ?? 0) + 1
        if (task.name === 'plan_agent_step') {
          return {
            ok: true as const,
            data: { intent: 'add_content', targetPath: '/act', needsInfo: [] },
            meta: {} as never,
          }
        }
        if (task.name === 'propose_patch') {
          return {
            ok: true as const,
            data: seen['propose_patch'] === 1 ? first : second,
            meta: {} as never,
          }
        }
        return { ok: false as const, error: { code: 'UNKNOWN' }, meta: {} as never }
      }),
    } as unknown as Gateway
  }

  const bad = {
    ops: [op({ op: 'add', path: '/activities/-', value: { name: { $ref: '/activities/0/name' } } })],
    summary: 's',
  }
  const good = {
    ops: [op({ op: 'add', path: '/activities/-', value: { name: 'CLB Tin học', highlights: [] } })],
    summary: 'Thêm hoạt động',
  }

  it('lượt sửa ra đề xuất dùng được → trả patch, không trả lỗi', async () => {
    const g = twoShot(bad, good)
    const r = await runChatTurn(deps(g), {
      message: 'Thêm mục Hoạt động mới',
      profile: profile(),
      history: [],
    })

    expect(r.kind).toBe('patch')
    expect(calledTasks(g).filter((t) => t === 'propose_patch')).toHaveLength(2)
  })

  it('lượt sửa nhận được LÝ DO cụ thể của lượt hỏng', async () => {
    const g = twoShot(bad, good)
    await runChatTurn(deps(g), { message: 'Thêm mục', profile: profile(), history: [] })

    const calls = (g.run as unknown as { mock: { calls: [{ name: string }, { corrections?: string[] }][] } })
      .mock.calls.filter((c) => c[0].name === 'propose_patch')
    // Cấm chung chung không ăn thua — phải chỉ ra ĐÚNG op vừa hỏng
    expect(calls[0]![1].corrections).toBeUndefined()
    expect(calls[1]![1].corrections?.[0]).toMatch(/activities.*không đúng dạng/i)
  })

  it('chỉ thử lại MỘT lần — mỗi lượt gọi là 5-10 giây người dùng ngồi chờ', async () => {
    const g = twoShot(bad, bad)
    const r = await runChatTurn(deps(g), { message: 'Thêm mục', profile: profile(), history: [] })

    expect(calledTasks(g).filter((t) => t === 'propose_patch')).toHaveLength(2)
    expect(r.kind).toBe('error')
  })
})
