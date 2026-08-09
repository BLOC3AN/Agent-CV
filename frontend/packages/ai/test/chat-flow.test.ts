import { describe, it, expect, vi } from 'vitest'
import { ProfileSchema, type PatchOp, type Profile } from '@hr/schema'
import { runChatTurn, type ChatFlowDeps } from '../src/chat-flow.js'
import { validateOps } from '../src/patch-guard.js'
import type { Gateway } from '../src/gateway.js'

/**
 * Test tầng ĐIỀU PHỐI một lượt chat — TDD §8.3, UC-51/52/53.
 *
 * Trọng tâm: gọi model mấy lần, theo thứ tự nào, và xử lý ra sao khi lượt gọi
 * trả về thứ không dùng được. Các test ở đây vẫn gọi `validateOps` vì phần lớn
 * đường đi hỏng chỉ lộ ra khi điều phối và kiểm duyệt chạy cùng nhau.
 *
 * Test riêng cho bản thân chốt kiểm duyệt nằm ở `patch-guard.test.ts`.
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

  it('TC-53-48b summary được cập nhật sau khi lọc op hỏng', async () => {
    const g = fakeGateway({
      plan_agent_step: { intent: 'rewrite_section', targetPath: '/work', needsInfo: [] },
      propose_patch: {
        ops: [
          op({
            op: 'add',
            path: '/basics/headline',
            value: 'AI Engineer',
            grounding: { type: 'inference', ref: 'suy-luan' },
          }),
          op({ path: '/work/0', value: { org: 'A', role: 'AI Engineer', highlights: [] } }),
          op({ path: '/work/1', value: { org: 'B', role: 'AI Engineer', highlights: [] } }),
          op({ path: '/work/2', value: { org: 'C', role: 'AI Engineer', highlights: [] } }),
        ],
        summary: 'Đã chuyển toàn bộ nội dung chi tiết từ mục Hoạt động sang mục Kinh nghiệm, bao gồm 3 dự án.',
      },
    })

    const r = await runChatTurn(deps(g), {
      message: 'chuyển hoạt động sang kinh nghiệm',
      profile: profile({ work: [], basics: { name: 'Nguyễn Văn A', links: [] } }),
      history: [],
    })

    expect(r.kind).toBe('patch')
    if (r.kind !== 'patch') return
    expect(r.proposal.ops).toHaveLength(1)
    expect(r.proposal.summary).toMatch(/1 thay đổi/)
    expect(r.proposal.summary).not.toMatch(/3 dự án|chuyển toàn bộ/i)
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

describe('TC-53-45b op bị Zod LƯỢC BỎ phải bị loại, không được báo là đã áp dụng', () => {
  it('CHẶN `add /summary` — hồ sơ không có field đó ở gốc', () => {
    // Đã xảy ra thật: op này được duyệt, hệ thống báo "đã áp dụng 1 thay đổi",
    // và nội dung biến mất. Zod lược khoá lạ chứ không báo lỗi, nên safeParse
    // vẫn thành công.
    const { valid, rejected } = validateOps(
      [op({ op: 'add', path: '/summary', value: 'AI Engineer chuyên sâu về Edge AIoT' })],
      profile(),
      MSG_IDS,
    )
    expect(valid).toHaveLength(0)
    expect(rejected[0]!.reason).toMatch(/không có chỗ|sẽ bị mất/)
  })

  it('CHO QUA `add /basics/introduce` — đúng chỗ thì vẫn thêm được', () => {
    const { valid, rejected } = validateOps(
      [op({ op: 'add', path: '/basics/introduce', value: 'AI Engineer chuyên sâu về Edge AIoT' })],
      profile(),
      MSG_IDS,
    )
    expect(rejected).toHaveLength(0)
    expect(valid).toHaveLength(1)
  })

  it('CHẶN field lạ bên trong một mục', () => {
    const { valid } = validateOps(
      [op({ op: 'add', path: '/work/0/salary', value: '20 triệu' })],
      profile(),
      MSG_IDS,
    )
    expect(valid).toHaveLength(0)
  })

  it('`add` vào cuối mảng vẫn qua — kiểm đúng phần tử VỪA thêm', () => {
    const { valid, rejected } = validateOps(
      [op({ op: 'add', path: '/activities/-', value: { name: 'CLB Tin học', highlights: ['a'] } })],
      profile(),
      MSG_IDS,
    )
    expect(rejected).toHaveLength(0)
    expect(valid).toHaveLength(1)
  })

  it('lý do loại NÊU TÊN chỗ sai để model tự sửa ở lượt hai', () => {
    const { rejected } = validateOps(
      [op({ op: 'add', path: '/summary', value: 'x' })],
      profile(),
      MSG_IDS,
    )
    expect(rejected[0]!.reason).toContain('summary')
  })
})

describe('mọi chuỗi HIỂN THỊ của đề xuất đều sạch con trỏ', () => {
  it('`summary` và `rationale` không lộ đường dẫn JSON', async () => {
    const g = fakeGateway({
      plan_agent_step: { intent: 'add_content', targetPath: '/basics', needsInfo: [] },
      propose_patch: {
        // Model đã viết đúng kiểu này ra màn hình thật
        ops: [
          op({
            op: 'add',
            path: '/basics/introduce',
            value: 'AI Engineer',
            rationale: 'Thêm phần giới thiệu vào /basics/introduce cho hồ sơ đầy đủ hơn',
          }),
        ],
        summary: 'Đã thêm nội dung vào /basics/introduce',
      },
    })
    const r = await runChatTurn(deps(g), {
      message: 'Viết giúp tôi phần giới thiệu',
      profile: profile(),
      history: [],
    })

    expect(r.kind).toBe('patch')
    if (r.kind !== 'patch') return
    expect(r.proposal.summary).not.toMatch(/\/basics|\/summary/)
    expect(r.proposal.ops[0]!.rationale).not.toMatch(/\/basics|\/summary/)
    // `path` là dữ liệu cho máy, KHÔNG phải chữ cho người — giữ nguyên
    expect(r.proposal.ops[0]!.path).toBe('/basics/introduce')
  })
})

describe('UC-57 — nhóm kỹ năng', () => {
  const withSkills = () =>
    profile({ skills: [{ name: 'YOLOv8' }, { name: 'Docker' }] } as never)

  it('TC-57-01 đặt `group` cho từng kỹ năng là op HỢP LỆ', () => {
    // Trước khi có field này, MỌI đề xuất gom nhóm đều bị loại — mà chính trợ
    // lý lại đi mời người dùng làm việc đó.
    const { valid, rejected } = validateOps(
      [
        op({ op: 'add', path: '/skills/0/group', value: 'Edge AI' }),
        op({ op: 'add', path: '/skills/1/group', value: 'MLOps' }),
      ],
      withSkills(),
      MSG_IDS,
    )
    expect(rejected).toHaveLength(0)
    expect(valid).toHaveLength(2)
  })

  it('vẫn CHẶN thay cả phần tử kỹ năng bằng một chuỗi', () => {
    // Đây là thứ model đã làm và gây ra "giá trị không đúng dạng ở skills/0"
    const { valid, rejected } = validateOps(
      [op({ path: '/skills/0', value: 'Edge AI: YOLOv8, ByteTrack' })],
      withSkills(),
      MSG_IDS,
    )
    expect(valid).toHaveLength(0)
    expect(rejected[0]!.reason).toMatch(/đang là object|không đúng dạng/i)
  })
})

describe('TC-53-47b khoá lạ BÊN TRONG object cũng phải bị chặn', () => {
  it('CHẶN kỹ năng kèm `highlights` — SkillSchema không có trường đó', () => {
    // Đo thật khi gom nhóm: người dùng nhìn thấy `highlights` trong khung so
    // sánh trước/sau, bấm đồng ý, rồi không nhận được nó.
    const { valid, rejected } = validateOps(
      [
        op({
          path: '/skills/0',
          value: { name: 'Python', group: 'ML Ops', highlights: ['Xử lý dữ liệu lớn'] },
        }),
      ],
      profile({ skills: [{ name: 'Python' }] } as never),
      MSG_IDS,
    )
    expect(valid).toHaveLength(0)
    expect(rejected[0]!.reason).toContain('highlights')
  })

  it('CHO QUA khi mọi trường đều có chỗ trong hồ sơ', () => {
    const { valid, rejected } = validateOps(
      [op({ path: '/skills/0', value: { name: 'Python', group: 'ML Ops' } })],
      profile({ skills: [{ name: 'Python' }] } as never),
      MSG_IDS,
    )
    expect(rejected).toHaveLength(0)
    expect(valid).toHaveLength(1)
  })

  it('giá trị chuỗi không bị ảnh hưởng', () => {
    const { valid } = validateOps([op({ path: '/work/0/role', value: 'Backend Developer' })], profile(), MSG_IDS)
    expect(valid).toHaveLength(1)
  })
})

describe('onReject — op bị loại phải ra được log', () => {
  /*
   * Khi UC-57 hỏng trên hồ sơ thật, log Next chỉ có dòng khởi động và log worker
   * chỉ có `parse_cv`. Không chỗ nào ghi op nào bị loại vì lý do gì, nên phải
   * bọc `gateway.run` bằng script riêng mới lần ra được nguyên nhân.
   *
   * Hệ thống biết chính xác nó vừa loại gì — không kể ra là tự bịt mắt mình.
   */
  const badOp = op({
    path: '/skills/0',
    value: { name: 'Python', tech: ['NumPy'] },
    grounding: { type: 'existing_field', ref: '/skills/0' },
  })
  const goodOp = op({
    op: 'add',
    path: '/skills/0/group',
    value: 'ML Ops',
    grounding: { type: 'existing_field', ref: '/skills/0' },
  })
  const withSkill = () => profile({ skills: [{ name: 'Python' }] } as never)

  it('báo op bị loại ở vòng 1, kèm lý do', async () => {
    const g = fakeGateway({
      plan_agent_step: { intent: 'rewrite', targetPath: '/skills', needsInfo: [] },
      propose_patch: { ops: [badOp, goodOp], summary: 'Gom nhóm kỹ năng' },
    })
    const seen: { round: number; reason: string }[] = []
    const r = await runChatTurn(
      { ...deps(g), onReject: (round, rej) => seen.push(...rej.map((x) => ({ round, reason: x.reason }))) },
      { message: 'Tổ chức lại mục kỹ năng', profile: withSkill(), history: [] },
    )

    expect(r.kind).toBe('patch')
    expect(seen).toHaveLength(1)
    expect(seen[0]!.round).toBe(1)
    expect(seen[0]!.reason).toContain('"tech"')
  })

  it('báo cả vòng SỬA khi vòng 1 loại sạch', async () => {
    const g = fakeGateway({
      plan_agent_step: { intent: 'rewrite', targetPath: '/skills', needsInfo: [] },
      propose_patch: { ops: [badOp], summary: 'Gom nhóm kỹ năng' },
    })
    const rounds: number[] = []
    await runChatTurn(
      { ...deps(g), onReject: (round) => rounds.push(round) },
      { message: 'Tổ chức lại mục kỹ năng', profile: withSkill(), history: [] },
    )
    // Vòng 1 loại sạch → gọi lại model → vòng 2 cũng loại (cùng mock)
    expect(rounds).toEqual([1, 2])
  })

  it('không op nào bị loại → không gọi onReject', async () => {
    const g = fakeGateway({
      plan_agent_step: { intent: 'rewrite', targetPath: '/skills', needsInfo: [] },
      propose_patch: { ops: [goodOp], summary: 'Gom nhóm kỹ năng' },
    })
    const onReject = vi.fn()
    const r = await runChatTurn(
      { ...deps(g), onReject },
      { message: 'Tổ chức lại mục kỹ năng', profile: withSkill(), history: [] },
    )
    expect(r.kind).toBe('patch')
    expect(onReject).not.toHaveBeenCalled()
  })
})

describe('TC-57-09 CHẶN xoá hàng loạt — BR-57.2', () => {
  /*
   * HỒI QUY, đo trên hồ sơ 24 kỹ năng: model không đủ 20 op để đặt nhóm cho
   * từng kỹ năng, nên chọn "xoá hết rồi thêm lại bản đã nhóm" — và trần 20 op
   * cắt mất toàn bộ phần thêm lại:
   *     remove /skills/0 … remove /skills/19    (không có op add nào)
   *     summary: "Đã xoá toàn bộ 20 kỹ năng cũ để chuẩn bị thêm kỹ năng mới"
   * User bấm đồng ý → mất sạch mục kỹ năng, còn summary hứa một việc không op
   * nào làm.
   */
  const manySkills = (n: number) =>
    profile({ skills: Array.from({ length: n }, (_, i) => ({ name: `S${i}` })) } as never)

  const rm = (path: string) => op({ op: 'remove', path, value: null })

  it('xoá 20 kỹ năng mà không thêm lại gì → loại HẾT', () => {
    const ops = Array.from({ length: 20 }, (_, i) => rm(`/skills/${i}`))
    const { valid, rejected } = validateOps(ops, manySkills(20), MSG_IDS)

    expect(valid).toHaveLength(0)
    expect(rejected).toHaveLength(20)
    expect(rejected[0]!.reason).toMatch(/nội dung sẽ mất/i)
    // Lý do phải chỉ đường: đặt "group", đừng xoá
    expect(rejected[0]!.reason).toContain('group')
    // và gọi tên mục bằng tiếng Việt
    expect(rejected[0]!.reason).toContain('Kỹ năng')
  })

  it('MỘT op xoá vẫn hợp lệ — "xoá kỹ năng trùng" là việc có thật', () => {
    const { valid, rejected } = validateOps([rm('/skills/1')], manySkills(3), MSG_IDS)
    expect(rejected).toHaveLength(0)
    expect(valid).toHaveLength(1)
  })

  it('xoá nhiều mà thêm lại đủ vẫn bị chặn vì LỆCH CHỈ SỐ', () => {
    // Chỉ số tính trên hồ sơ TRƯỚC patch; xoá /skills/0 xong thì /skills/1 đã
    // trỏ sang kỹ năng khác. Người dùng còn bỏ tick được từng op.
    const ops = [
      rm('/skills/0'),
      rm('/skills/1'),
      op({ op: 'add', path: '/skills/-', value: { name: 'Python', group: 'ML' } }),
      op({ op: 'add', path: '/skills/-', value: { name: 'Docker', group: 'MLOps' } }),
    ]
    const { valid, rejected } = validateOps(ops, manySkills(3), MSG_IDS)

    expect(rejected.filter((r) => r.op.op === 'remove')).toHaveLength(2)
    expect(rejected[0]!.reason).toMatch(/lệch/i)
    // Các op `add` KHÔNG bị kéo theo — chúng vẫn dùng được
    expect(valid.filter((o) => o.op === 'add')).toHaveLength(2)
  })

  it('xoá ở hai mục KHÁC nhau không cộng dồn vào nhau', () => {
    const p = profile({
      skills: [{ name: 'A' }, { name: 'B' }],
      work: [
        { org: 'X', role: 'Dev', highlights: ['a'] },
        { org: 'Y', role: 'Dev', highlights: ['b'] },
      ],
    } as never)
    const { valid, rejected } = validateOps([rm('/skills/0'), rm('/work/0')], p, MSG_IDS)
    expect(rejected).toHaveLength(0)
    expect(valid).toHaveLength(2)
  })
})

describe('TC-57-08 lý do loại phải nói field ĐÚNG, không chỉ field sai', () => {
  /*
   * HỒI QUY UC-57 trên hồ sơ 24 kỹ năng: model trả
   *   replace /skills/N {"name":…,"group":…,"tech":[…],"highlights":[…]}
   * cho cả 16 op. Lý do loại cũ chỉ nói "Hồ sơ không có trường tech, highlights"
   * — một lời cấm trần trụi. Lượt sửa, model bỏ luôn `group` (thứ nó đang cần)
   * mà vẫn giữ `tech`/`highlights` → loại hết lần hai → NO_VALID_OPS.
   *
   * Lý do loại CHÍNH LÀ lời nhắc gửi model, nên nó phải chứa dạng đúng.
   */
  const withPython = () => profile({ skills: [{ name: 'Python' }] } as never)

  it('nêu đủ field hợp lệ của kỹ năng', () => {
    const { rejected } = validateOps(
      [
        op({
          path: '/skills/0',
          value: { name: 'Python', group: 'ML Ops', tech: ['NumPy'], highlights: ['Xử lý dữ liệu'] },
        }),
      ],
      withPython(),
      MSG_IDS,
    )
    const reason = rejected[0]!.reason
    for (const f of ['name', 'level', 'canonical', 'group']) {
      expect(reason).toContain(`"${f}"`)
    }
    // và vẫn chỉ ra field phải bỏ
    expect(reason).toContain('"tech"')
    expect(reason).toContain('"highlights"')
    // gọi tên mục bằng tiếng Việt, không phải "/skills/0"
    expect(reason).toContain('kỹ năng')
    expect(reason).not.toContain('/skills')
  })

  it('KHÔNG gợi ý field của mục khác — mỗi mục một bộ field', () => {
    const { rejected } = validateOps(
      [op({ path: '/skills/0', value: { name: 'Python', highlights: ['x'] } })],
      withPython(),
      MSG_IDS,
    )
    // `org`, `role` là field của chỗ làm, không được lọt vào lời nhắc cho kỹ năng
    expect(rejected[0]!.reason).not.toContain('"org"')
    expect(rejected[0]!.reason).not.toContain('"role"')
  })

  it('mục khác cũng được lời nhắc đúng bộ field của nó', () => {
    const { rejected } = validateOps(
      [op({ path: '/work/0', value: { org: 'Cty X', role: 'Dev', group: 'Backend' } })],
      profile(),
      MSG_IDS,
    )
    // `group` là field của kỹ năng, chỗ làm không có
    expect(rejected[0]!.reason).toContain('chỗ làm')
    expect(rejected[0]!.reason).toContain('"org"')
    expect(rejected[0]!.reason).toContain('"group"')
  })

  it('op hợp lệ vẫn không sinh lời nhắc nào', () => {
    const { valid, rejected } = validateOps(
      [op({ op: 'add', path: '/skills/0/group', value: 'Edge AI' })],
      withPython(),
      MSG_IDS,
    )
    expect(rejected).toHaveLength(0)
    expect(valid).toHaveLength(1)
  })
})
