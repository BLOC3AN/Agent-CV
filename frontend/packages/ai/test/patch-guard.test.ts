import { describe, it, expect } from 'vitest'
import { ProfileSchema, type PatchOp, type Profile } from '@hr/schema'
import { validateOps } from '../src/patch-guard.js'

/**
 * Chốt chặn giữa model và hồ sơ người dùng — TDD §8.3, BR-53.2.
 *
 * Model 4B sẽ trả về op trỏ vào đường dẫn không có thật và dẫn nguồn sai — lọt
 * qua đây thì user thấy một đề xuất trông đáng tin và tick nhầm.
 *
 * Chỉ test hàm thuần: không gateway, không mock, không lượt chat. Test phần
 * ĐIỀU PHỐI ở `chat-flow.test.ts`.
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

  it('CHẶN `add` vào index chưa tồn tại — thêm vào mảng phải dùng `/-`', () => {
    const { valid, rejected } = validateOps(
      [op({ op: 'add', path: '/work/1', value: { org: 'Y', role: 'Dev', highlights: [] } })],
      profile(),
      MSG_IDS,
    )
    expect(valid).toHaveLength(0)
    expect(rejected[0]!.reason).toMatch(/\/-|cuối mảng/)
  })

  it('CHẶN `/work/0` khi mảng work rỗng — phải dùng `add /work/-`', () => {
    const { valid, rejected } = validateOps(
      [op({ op: 'add', path: '/work/0', value: { org: 'Y', role: 'Dev', highlights: [] } })],
      profile({ work: [] }),
      MSG_IDS,
    )
    expect(valid).toHaveLength(0)
    expect(rejected[0]!.reason).toMatch(/\/-|cuối mảng/)
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

  it('TC-53-47b CHẶN `replace` no-op vì không tạo thay đổi thật', () => {
    const { valid, rejected } = validateOps(
      [op({ path: '/basics/summary', value: 'AI Engineer' })],
      profile({ basics: { name: 'Nguyễn Văn A', summary: 'AI Engineer', links: [] } }),
      MSG_IDS,
    )

    expect(valid).toHaveLength(0)
    expect(rejected[0]!.reason).toMatch(/không thay đổi/)
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
