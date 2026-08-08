import { describe, it, expect, beforeAll } from 'vitest'
import { ProviderRegistry } from '@hr/ai'
import type { ProfileChunk } from '../src/keyword.js'
import { cosine, scoreSemantic } from '../src/semantic.js'
import type { JDRequirements } from '@hr/schema'

/**
 * Đo lớp ngữ nghĩa trên embedder + reranker THẬT.
 *
 * Ngưỡng STRONG/MODERATE/WEAK trong `semantic.ts` là con số phải ĐO mới biết
 * đúng, không suy ra được. Test này chính là phép đo đó — nếu ai đó đổi model
 * hoặc phiên bản, nó sẽ báo ngay thay vì để điểm số trôi âm thầm.
 *
 *   npm run test:int
 */

let embedder: { embedBatch(t: string[]): Promise<number[][]> } | null = null
let reranker: {
  rerank(q: string, d: string[], n?: number): Promise<{ index: number; score: number }[]>
} | null = null
let up = false

beforeAll(async () => {
  try {
    const reg = new ProviderRegistry()
    embedder = reg.embed()
    reranker = reg.rerank()
    const v = await embedder.embedBatch(['thử'])
    up = v[0]?.length === 1024
  } catch {
    up = false
  }
}, 60_000)

function jd(over: Partial<JDRequirements> = {}): JDRequirements {
  return {
    title: 'Backend Developer',
    language: 'vi',
    roleFamily: 'backend_developer',
    seniority: 'junior',
    yearsRequired: null,
    hardSkills: [],
    softSkills: [],
    responsibilities: [],
    atsKeywords: [],
    niceToHave: [],
    ...over,
  } as JDRequirements
}

/** Cặp câu CÙNG NGHĨA nhưng KHÔNG chung từ khoá — lý do lớp này tồn tại. */
const SAME_MEANING: [string, string][] = [
  [
    'Có kinh nghiệm tối ưu hiệu năng hệ thống',
    'Giảm thời gian phản hồi API từ 800ms xuống 120ms bằng cách thêm chỉ mục và bộ nhớ đệm',
  ],
  [
    'Kinh nghiệm làm việc với hàng đợi tin nhắn',
    'Xử lý bất đồng bộ đơn hàng qua RabbitMQ, đảm bảo không mất tin khi dịch vụ khởi động lại',
  ],
  [
    'Experience with automated testing',
    'Viết unit test và integration test cho toàn bộ tầng nghiệp vụ, độ phủ 85%',
  ],
  [
    'Khả năng làm việc với khách hàng nước ngoài',
    'Trao đổi trực tiếp với đối tác Nhật Bản để chốt yêu cầu và báo cáo tiến độ hàng tuần',
  ],
]

/** Cặp KHÔNG liên quan — phải rơi xuống rõ rệt so với cặp trên. */
const UNRELATED: [string, string][] = [
  [
    'Có kinh nghiệm tối ưu hiệu năng hệ thống',
    'Tham gia câu lạc bộ bóng đá của trường, giành giải nhì cấp khoa',
  ],
  [
    'Kinh nghiệm làm việc với hàng đợi tin nhắn',
    'Chứng chỉ tiếng Nhật NAT-TEST N5',
  ],
  [
    'Thành thạo Kubernetes và hạ tầng đám mây',
    'Sở thích: đọc sách, nghe nhạc, du lịch cùng bạn bè',
  ],
  [
    'Experience with automated testing',
    'Tốt nghiệp Đại học Bách Khoa Hà Nội, ngành Công nghệ thông tin, GPA 3.2',
  ],
  [
    'Có khả năng thiết kế kiến trúc microservice',
    'Tham gia hiến máu nhân đạo và các hoạt động tình nguyện mùa hè xanh',
  ],
]

describe('bge-m3 — khoảng cách giữa "cùng nghĩa" và "lạc đề"', () => {
  it(
    'cặp cùng nghĩa phải cao hơn HẲN cặp lạc đề',
    async () => {
      if (!up) {
        console.warn('⏭  embedder không phản hồi')
        return
      }

      const same: number[] = []
      for (const [a, b] of SAME_MEANING) {
        const [va, vb] = await embedder!.embedBatch([a, b])
        same.push(cosine(va!, vb!))
      }
      const diff: number[] = []
      for (const [a, b] of UNRELATED) {
        const [va, vb] = await embedder!.embedBatch([a, b])
        diff.push(cosine(va!, vb!))
      }

      const minSame = Math.min(...same)
      const maxDiff = Math.max(...diff)
      console.log(
        `  cùng nghĩa: ${same.map((s) => s.toFixed(3)).join(' ')}  (thấp nhất ${minSame.toFixed(3)})`,
      )
      console.log(
        `  lạc đề    : ${diff.map((s) => s.toFixed(3)).join(' ')}  (cao nhất ${maxDiff.toFixed(3)})`,
      )

      // Hai vùng phải TÁCH RỜI. Chồng lấn nghĩa là không có ngưỡng nào phân
      // biệt được, và cả lớp ngữ nghĩa trở nên vô dụng.
      expect(minSame, `cùng nghĩa ${minSame.toFixed(3)} ≤ lạc đề ${maxDiff.toFixed(3)}`)
        .toBeGreaterThan(maxDiff)
    },
    120_000,
  )

  it(
    'ngưỡng WEAK/STRONG trong code nằm ĐÚNG giữa hai vùng đo được',
    async () => {
      if (!up) return

      const same: number[] = []
      for (const [a, b] of SAME_MEANING) {
        const [va, vb] = await embedder!.embedBatch([a, b])
        same.push(cosine(va!, vb!))
      }
      const diff: number[] = []
      for (const [a, b] of UNRELATED) {
        const [va, vb] = await embedder!.embedBatch([a, b])
        diff.push(cosine(va!, vb!))
      }

      // Ngưỡng cứng trong semantic.ts — đổi model mà quên chỉnh thì test này đỏ
      const WEAK = 0.45
      const STRONG = 0.6

      // Phía NGUY HIỂM: lạc đề lọt qua WEAK sẽ thổi phồng điểm
      expect(Math.max(...diff), `lạc đề vượt ngưỡng WEAK=${WEAK}`).toBeLessThan(WEAK)
      // Phía BỎ SÓT: bằng chứng diễn đạt lại phải được tính
      expect(Math.min(...same), `cùng nghĩa dưới ngưỡng WEAK=${WEAK}`).toBeGreaterThan(WEAK)
      // STRONG phải với tới được, nếu không không bằng chứng nào đạt "strong"
      expect(STRONG, 'STRONG cao hơn mọi cặp cùng nghĩa đo được').toBeLessThan(
        Math.max(...same) + 0.06,
      )
    },
    120_000,
  )

  it(
    'xuyên ngôn ngữ: JD tiếng Anh khớp CV tiếng Việt',
    async () => {
      if (!up) return
      const [en, vi] = await embedder!.embedBatch([
        'Experience building RESTful APIs with Node.js',
        'Xây dựng API RESTful bằng NodeJS phục vụ 10.000 người dùng',
      ])
      const sim = cosine(en!, vi!)
      console.log(`  EN↔VI cùng nghĩa: ${sim.toFixed(3)}`)
      expect(sim).toBeGreaterThan(0.42)
    },
    60_000,
  )
})

describe('scoreSemantic với hạ tầng thật', () => {
  const chunks: ProfileChunk[] = [
    {
      path: '/work/0/highlights/0',
      text: 'Giảm thời gian phản hồi API từ 800ms xuống 120ms bằng chỉ mục và bộ nhớ đệm Redis',
    },
    {
      path: '/work/0/highlights/1',
      text: 'Trao đổi trực tiếp với đối tác Nhật Bản để chốt yêu cầu và báo cáo tiến độ',
    },
    {
      path: '/activities/0',
      text: 'Tham gia câu lạc bộ bóng đá của trường, giành giải nhì cấp khoa',
    },
    {
      path: '/projects/0/highlights/0',
      text: 'Viết unit test và integration test cho tầng nghiệp vụ, độ phủ 85%',
    },
  ]

  it(
    'chọn đúng bằng chứng cho từng yêu cầu',
    async () => {
      if (!up) return

      const r = await scoreSemantic(
        chunks,
        jd({
          hardSkills: ['Tối ưu hiệu năng hệ thống'],
          responsibilities: ['Viết kiểm thử tự động', 'Làm việc với khách hàng nước ngoài'],
        }),
        embedder,
      )

      expect(r.degraded).toBe(false)
      for (const m of r.matches) {
        console.log(
          `  "${m.requirement}" → ${m.evidence[0]?.path} (${m.evidence[0]?.similarity}) ${m.strength}`,
        )
      }

      const byReq = Object.fromEntries(r.matches.map((m) => [m.requirement, m.evidence[0]?.path]))
      expect(byReq['Tối ưu hiệu năng hệ thống']).toBe('/work/0/highlights/0')
      expect(byReq['Viết kiểm thử tự động']).toBe('/projects/0/highlights/0')
      expect(byReq['Làm việc với khách hàng nước ngoài']).toBe('/work/0/highlights/1')
    },
    180_000,
  )

  it(
    'yêu cầu KHÔNG có trong CV → strength thấp, không bịa bằng chứng mạnh',
    async () => {
      if (!up) return
      const r = await scoreSemantic(
        chunks,
        jd({ hardSkills: ['Vận hành cụm Kubernetes trên nhiều vùng địa lý'] }),
        embedder,
      )
      const m = r.matches[0]!
      console.log(`  yêu cầu vắng mặt → ${m.evidence[0]?.similarity} ${m.strength}`)
      expect(m.strength, 'bịa ra khớp mạnh cho thứ CV không có').not.toBe('strong')
    },
    120_000,
  )

  it(
    'reranker thật chạy được và trả logit',
    async () => {
      if (!up || !reranker) return
      const r = await scoreSemantic(
        chunks,
        jd({ hardSkills: ['Tối ưu hiệu năng hệ thống'] }),
        embedder,
        reranker,
        { rerank: true },
      )

      expect(r.reranked, 'reranker không chạy được').toBe(true)
      const top = r.matches[0]!.evidence[0]!
      console.log(`  rerank: ${top.path} logit=${top.rerankScore}`)
      expect(typeof top.rerankScore).toBe('number')
      // Chọn đúng đoạn, bất kể logit âm hay dương
      expect(top.path).toBe('/work/0/highlights/0')
    },
    180_000,
  )
})
