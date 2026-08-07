import { describe, it, expect, beforeAll } from 'vitest'
import { ProfileSchema, type Profile } from '@hr/schema'
import { Gateway } from '../src/gateway.js'
import { runChatTurn, validateOps } from '../src/chat-flow.js'
import { planAgentStepTask, proposePatchTask } from '../src/tasks/agent.js'
import { redactKeepShape, stripPII } from '../src/pii.js'

/**
 * Trợ lý chat trên model THẬT — UC-51/52/53.
 *
 * Đo xem model 4B có sinh được JSON Patch dùng được không. Đây là phần rủi ro
 * nhất của M4: model phải trả đúng đường dẫn CÓ THẬT trong hồ sơ, và tự đánh
 * giá đúng nguồn gốc thay đổi.
 *
 *   npm run test:int
 */

let gw: Gateway
let up = false

beforeAll(async () => {
  gw = new Gateway()
  up = await gw.health().then((h) => h.models['local.reasoner'] === true).catch(() => false)
}, 60_000)

/** Hồ sơ TỔNG HỢP — không dùng CV thật (R8). */
function cv(): Profile {
  return ProfileSchema.parse({
    schemaVersion: 1,
    language: 'vi',
    basics: { name: 'Ứng viên A', headline: 'Backend Developer' },
    skills: [{ name: 'NodeJS' }, { name: 'PostgreSQL' }],
    work: [
      {
        org: 'Công ty phần mềm A',
        role: 'Backend Developer',
        startDate: '2023',
        endDate: 'nay',
        highlights: [
          'Chịu trách nhiệm phát triển và bảo trì các API của hệ thống bán hàng, làm việc với đội frontend để tích hợp, đồng thời tham gia sửa lỗi khi có sự cố xảy ra trên môi trường production',
          'Tham gia vào việc tối ưu hoá cơ sở dữ liệu',
        ],
      },
    ],
    projects: [
      {
        name: 'Hệ thống quản lý kho',
        tech: ['NodeJS', 'PostgreSQL'],
        highlights: ['Xây dựng chức năng nhập xuất kho'],
      },
    ],
    education: [{ school: 'Đại học Bách Khoa', degree: 'Kỹ sư CNTT', highlights: [] }],
  })
}

describe('plan_agent_step trên model thật', () => {
  it(
    'hiểu đúng ý định và mục cần sửa',
    async () => {
      if (!up) {
        console.warn('⏭  model server không phản hồi')
        return
      }
      const cases: [string, string[]][] = [
        ['Làm gọn lại mục kinh nghiệm giúp em', ['rewrite_section', 'remove_content']],
        ['CV của em ổn chưa ạ?', ['ask_question', 'explain']],
        ['Thêm một dự án cá nhân vào CV', ['add_content']],
      ]

      for (const [msg, expected] of cases) {
        const r = await gw.run(planAgentStepTask, {
          message: msg,
          compactProfile: stripPII(cv()),
          history: [],
          language: 'vi',
        })
        expect(r.ok, `"${msg}": ${r.ok ? '' : r.error.code}`).toBe(true)
        if (!r.ok) continue
        console.log(`  "${msg}" → ${r.data.intent} ${r.data.targetPath ?? '—'} needs=${r.data.needsInfo.length}`)
        expect(expected, `"${msg}" cho ra ${r.data.intent}`).toContain(r.data.intent)
      }
    },
    300_000,
  )
})

describe('propose_patch trên model thật', () => {
  it(
    'sinh op trỏ vào đường dẫn CÓ THẬT trong hồ sơ',
    async () => {
      if (!up) return
      const profile = cv()

      const r = await gw.run(proposePatchTask, {
        message: 'Làm gọn lại mục kinh nghiệm, mỗi gạch đầu dòng ngắn hơn',
        intent: 'rewrite_section',
        targetPath: '/work',
        compactProfile: redactKeepShape(profile),
        answers: [],
        kbChunks: [],
        language: 'vi',
      })

      expect(r.ok, r.ok ? '' : `propose_patch hỏng: ${r.error.code}`).toBe(true)
      if (!r.ok) return

      // Đo riêng ĐƯỜNG DẪN, không lẫn với kiểm tra dẫn nguồn: hai thứ hỏng vì
      // hai lý do khác nhau và cần sửa theo hai cách khác nhau.
      const pathOnly = validateOps(
        r.data.ops.map((o) => ({ ...o, grounding: { type: 'inference' as const, ref: 'x' } })),
        profile,
        new Set(),
      )
      console.log(`  model sinh ${r.data.ops.length} op · đường dẫn hợp lệ ${pathOnly.valid.length}`)
      for (const op of r.data.ops) {
        console.log(`    ${op.op} ${op.path} [${op.grounding.type}]`)
      }
      for (const x of pathOnly.rejected) console.log(`    ✗ ${x.op.path} — ${x.reason}`)

      // Phép đo QUYẾT ĐỊNH của M4: model 4B có sinh được JSON Pointer dùng được
      // không. Tất cả sai đường dẫn nghĩa là tính năng chat vô dụng.
      expect(pathOnly.valid.length, 'không đường dẫn nào có thật').toBeGreaterThan(0)
    },
    300_000,
  )

  it(
    'số bịa ra KHÔNG lọt qua được tầng kiểm duyệt (BR-52.1)',
    async () => {
      if (!up) return
      const profile = cv()

      const r = await gw.run(proposePatchTask, {
        message: 'Thêm số liệu vào các gạch đầu dòng cho ấn tượng hơn',
        intent: 'rewrite_section',
        targetPath: '/work/0/highlights',
        compactProfile: redactKeepShape(profile),
        answers: [],
        kbChunks: [],
        language: 'vi',
      })
      if (!r.ok) return

      // Hồ sơ không có con số nào, và không có câu trả lời nào của người dùng.
      // Mọi con số trong đề xuất đều là bịa.
      //
      // Điều PHẢI đúng không phải "model không bao giờ bịa" — model 4B sẽ bịa,
      // đó là bản chất của nó. Điều phải đúng là: số bịa ra KHÔNG BAO GIỜ tới
      // tay người dùng dưới dạng "có nguồn". Nó phải bị loại, hoặc bị đánh dấu
      // `inference` để giao diện không tick sẵn.
      const numbers = /\d+\s*(%|người dùng|user|giây|ms|lần|triệu|nghìn)/i
      const raw = r.data.ops.filter((op) =>
        numbers.test(typeof op.value === 'string' ? op.value : JSON.stringify(op.value ?? '')),
      )
      console.log(`  model sinh ${r.data.ops.length} op, ${raw.length} op có số bịa`)
      for (const op of raw) console.log(`    ⚠ ${op.path} [${op.grounding.type}]`)

      // Không có câu trả lời nào → mọi dẫn nguồn user_message bị chặn, và mọi
      // số không có trong hồ sơ bị hạ xuống `inference`
      const { valid } = validateOps(r.data.ops, profile, new Set(), [])
      const leaked = valid.filter(
        (op) =>
          numbers.test(typeof op.value === 'string' ? op.value : JSON.stringify(op.value ?? '')) &&
          op.grounding.type !== 'inference',
      )
      for (const op of leaked) {
        console.log(`    🔴 LỌT: ${op.path} [${op.grounding.type}] ${String(op.value).slice(0, 60)}`)
      }
      expect(leaked.map((o) => `${o.path} [${o.grounding.type}]`)).toEqual([])
    },
    300_000,
  )
})

describe('runChatTurn đầu-cuối', () => {
  it(
    '"làm gọn mục kinh nghiệm" ra được đề xuất dùng được',
    async () => {
      if (!up) return
      const profile = cv()
      const r = await runChatTurn(
        { gateway: gw, messageIds: new Set(['msg-1']) },
        { message: 'Làm gọn lại mục kinh nghiệm giúp em', profile, history: [] },
      )

      console.log(`  kind=${r.kind}`)
      if (r.kind === 'patch') {
        console.log(`  tóm tắt: ${r.proposal.summary}`)
        for (const op of r.proposal.ops) console.log(`    ${op.op} ${op.path}`)
      } else if (r.kind === 'error') {
        console.log(`  ${r.code}: ${r.message}`)
      }

      expect(['patch', 'clarify'], `nhận được ${r.kind}`).toContain(r.kind)
    },
    300_000,
  )

  /**
   * TC-57-07 — nhóm kỹ năng trên hồ sơ có NHIỀU kỹ năng.
   *
   * Test này lẽ ra phải có từ khi làm UC-57. TESTCASES §TC-57-07 đã ghi nó là
   * P0 nhưng không ai viết, nên tính năng ra bản chạy trong trạng thái: hồ sơ
   * chứa được `group`, template hiện được `group`, mà model KHÔNG bao giờ sinh
   * nổi một op hợp lệ — vì `CvItemSchema` gộp field mọi mục nên nó gắn thêm
   * `tech`/`highlights` vào từng kỹ năng và bị loại sạch.
   *
   * Chỉ hồ sơ nhiều kỹ năng mới bộc lộ: với 2 kỹ năng, model không có lý do gì
   * để gom nhóm.
   */
  it(
    'TC-57-07 "tổ chức lại mục kỹ năng" ra đề xuất dùng được, không loại sạch',
    async () => {
      if (!up) return
      const profile = ProfileSchema.parse({
        ...cv(),
        skills: [
          'Python', 'C++', 'PyTorch', 'TensorFlow Lite', 'ONNX', 'TensorRT',
          'YOLOv5', 'YOLOv8', 'ByteTrack', 'Triton Inference Server',
          'Docker Compose', 'Nginx', 'Apache Kafka', 'Jetson Edge Devices',
          'PostgreSQL', 'Redis', 'MinIO', 'Grafana', 'Loki', 'Dozzle',
        ].map((name) => ({ name, level: 'intermediate' })),
      })

      const rejectedLog: { round: number; reason: string }[] = []
      const r = await runChatTurn(
        {
          gateway: gw,
          messageIds: new Set(['msg-1']),
          onReject: (round, rejected) => {
            for (const x of rejected) rejectedLog.push({ round, reason: x.reason })
          },
        },
        { message: 'Tổ chức lại các mục kỹ năng cho tôi', profile, history: [] },
      )

      console.log(`  kind=${r.kind}`)
      for (const x of rejectedLog) console.log(`    [vòng ${x.round}] loại: ${x.reason}`)
      if (r.kind === 'patch') {
        for (const op of r.proposal.ops) {
          console.log(`    ${op.op} ${op.path} = ${JSON.stringify(op.value)}`)
        }
      } else if (r.kind === 'error') {
        console.log(`  ${r.code}: ${r.message}`)
      }

      // Người dùng gõ một yêu cầu hợp lệ mà hệ thống có đường làm → phải ra
      // đề xuất, không được trả lỗi "bạn thử nói cụ thể hơn"
      expect(r.kind, `nhận được ${r.kind}`).toBe('patch')
      if (r.kind !== 'patch') return

      // Và đề xuất phải thực sự gom nhóm, không phải sửa vài chữ cho có
      const touchesGroup = r.proposal.ops.filter(
        (o) =>
          o.path.startsWith('/skills/') &&
          (o.path.endsWith('/group') ||
            (typeof o.value === 'object' &&
              o.value !== null &&
              'group' in (o.value as Record<string, unknown>))),
      )
      expect(touchesGroup.length, 'không op nào đặt nhóm cho kỹ năng').toBeGreaterThan(0)

      // Không kỹ năng nào được biến mất (BR-57.2)
      for (const o of r.proposal.ops) {
        expect(o.op, `op ${o.op} ${o.path} xoá kỹ năng`).not.toBe('remove')
      }
    },
    300_000,
  )
})
