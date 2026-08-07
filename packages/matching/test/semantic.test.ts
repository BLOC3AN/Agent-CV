import { describe, it, expect, vi } from 'vitest'
import type { JDRequirements } from '@hr/schema'
import type { ProfileChunk } from '../src/keyword.js'
import { cosine, meaningfulChunks, scoreSemantic, type EmbedFn, type RerankFn } from '../src/semantic.js'

/**
 * Test lớp ngữ nghĩa — TDD §8.2 lớp 2.
 *
 * Dùng vector DỰNG SẴN thay vì gọi embedder thật: điều đang kiểm chứng là phép
 * tính và cách hỏng, không phải chất lượng của bge-m3. Chất lượng model là việc
 * của `semantic.int.test.ts`.
 */

function jd(over: Partial<JDRequirements> = {}): JDRequirements {
  return {
    title: 'Backend Developer',
    language: 'vi',
    roleFamily: 'backend_developer',
    seniority: 'fresher',
    yearsRequired: null,
    hardSkills: [],
    softSkills: [],
    responsibilities: [],
    atsKeywords: [],
    niceToHave: [],
    ...over,
  } as JDRequirements
}

const chunks: ProfileChunk[] = [
  { path: '/work/0/highlights/0', text: 'Giảm thời gian phản hồi API từ 800ms xuống 120ms' },
  { path: '/work/0/highlights/1', text: 'Xây dựng hệ thống báo cáo cho phòng kinh doanh' },
  { path: '/projects/0/highlights/0', text: 'Thiết kế cơ sở dữ liệu cho ứng dụng thương mại điện tử' },
]

/** Embedder giả: trả vector theo bảng tra, cho phép dựng độ tương đồng chính xác. */
function fakeEmbedder(map: Record<string, number[]>, fallback = [0, 0, 1]): EmbedFn {
  return {
    embedBatch: async (texts) => texts.map((t) => map[t] ?? fallback),
  }
}

describe('cosine', () => {
  it('vector trùng nhau → 1', () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 5)
  })

  it('vuông góc → 0', () => {
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 5)
  })

  it('không phụ thuộc độ dài vector — bge-m3 KHÔNG chuẩn hoá sẵn', () => {
    expect(cosine([1, 2, 3], [10, 20, 30])).toBeCloseTo(1, 5)
  })

  it('kẹp giá trị âm về 0 — "liên quan âm" không có nghĩa gì', () => {
    expect(cosine([1, 0], [-1, 0])).toBe(0)
  })

  it('vector rỗng / lệch chiều → 0, không ném lỗi', () => {
    expect(cosine([], [])).toBe(0)
    expect(cosine([1, 2], [1, 2, 3])).toBe(0)
    expect(cosine([0, 0], [1, 1])).toBe(0)
  })
})

describe('meaningfulChunks', () => {
  it('bỏ đoạn quá ngắn — "React" không thêm gì so với lớp keyword', () => {
    const out = meaningfulChunks([
      { path: '/skills/0/name', text: 'React' },
      { path: '/work/0/highlights/0', text: 'Xây dựng API bằng NodeJS phục vụ 10.000 người dùng' },
    ])
    expect(out.map((c) => c.path)).toEqual(['/work/0/highlights/0'])
  })
})

describe('scoreSemantic — suy giảm chứ không sập (TDD §5.5)', () => {
  it('không có embedder → degraded, KHÔNG ném lỗi', async () => {
    const r = await scoreSemantic(chunks, jd({ hardSkills: ['tối ưu hiệu năng'] }), null)
    expect(r.degraded).toBe(true)
    expect(r.score).toBeNull()
    expect(r.degradedReason).toBeTruthy()
  })

  it('embedder chết giữa chừng → degraded, không sập cả phân tích', async () => {
    const broken: EmbedFn = {
      embedBatch: async () => {
        throw new Error('ECONNREFUSED')
      },
    }
    const r = await scoreSemantic(chunks, jd({ hardSkills: ['tối ưu hiệu năng'] }), broken)

    expect(r.degraded).toBe(true)
    expect(r.score).toBeNull()
    expect(r.degradedReason).toContain('ECONNREFUSED')
  })

  it('lý do suy giảm viết cho NGƯỜI đọc, không phải mã lỗi trần', async () => {
    const r = await scoreSemantic(chunks, jd({ hardSkills: ['x'] }), null)
    expect(r.degradedReason).toMatch(/ngữ nghĩa/)
  })

  it('JD không có yêu cầu → bỏ lớp, nhưng KHÔNG phải degraded', async () => {
    // Khác nhau: "không đo được" (degraded) vs "không có gì để đo"
    const r = await scoreSemantic(chunks, jd(), fakeEmbedder({}))
    expect(r.score).toBeNull()
    expect(r.degraded).toBe(false)
  })

  it('CV không có đoạn nào đủ dài → bỏ lớp, không degraded', async () => {
    const r = await scoreSemantic(
      [{ path: '/skills/0/name', text: 'React' }],
      jd({ hardSkills: ['React'] }),
      fakeEmbedder({}),
    )
    expect(r.score).toBeNull()
    expect(r.degraded).toBe(false)
  })
})

describe('scoreSemantic — chấm điểm', () => {
  const REQ = 'tối ưu hiệu năng hệ thống'

  it('bắt được chỗ CÙNG NGHĨA nhưng KHÁC CHỮ', async () => {
    // Đây là lý do lớp này tồn tại: JD hỏi "tối ưu hiệu năng", CV viết
    // "giảm thời gian phản hồi từ 800ms xuống 120ms" — không chung từ nào
    const embedder = fakeEmbedder({
      [REQ]: [1, 0, 0],
      [chunks[0]!.text]: [0.95, 0.31, 0], // rất gần
      [chunks[1]!.text]: [0.3, 0.95, 0], // xa
      [chunks[2]!.text]: [0.2, 0.98, 0],
    })

    const r = await scoreSemantic(chunks, jd({ hardSkills: [REQ] }), embedder)

    expect(r.matches[0]!.evidence[0]!.path).toBe('/work/0/highlights/0')
    expect(r.matches[0]!.strength).toBe('strong')
    expect(r.score).toBe(100)
  })

  it('không có gì liên quan → strength none, điểm 0', async () => {
    const embedder = fakeEmbedder({ [REQ]: [1, 0, 0] }, [0, 1, 0])
    const r = await scoreSemantic(chunks, jd({ hardSkills: [REQ] }), embedder)

    expect(r.matches[0]!.strength).toBe('none')
    expect(r.score).toBe(0)
  })

  it('bằng chứng sắp giảm dần và giới hạn topK', async () => {
    const embedder = fakeEmbedder({
      [REQ]: [1, 0, 0],
      [chunks[0]!.text]: [0.9, 0.4, 0],
      [chunks[1]!.text]: [0.7, 0.7, 0],
      [chunks[2]!.text]: [0.5, 0.86, 0],
    })
    const r = await scoreSemantic(chunks, jd({ hardSkills: [REQ] }), embedder, null, { topK: 2 })

    const ev = r.matches[0]!.evidence
    expect(ev).toHaveLength(2)
    expect(ev[0]!.similarity).toBeGreaterThan(ev[1]!.similarity)
  })

  it('mọi bằng chứng đều có JSON Pointer trỏ về CV', async () => {
    const embedder = fakeEmbedder({ [REQ]: [1, 0, 0] }, [0.9, 0.4, 0])
    const r = await scoreSemantic(chunks, jd({ hardSkills: [REQ] }), embedder)

    for (const m of r.matches) {
      for (const e of m.evidence) expect(e.path).toMatch(/^\//)
    }
  })

  it('điểm nằm trong 0..100 và là số nguyên', async () => {
    const embedder = fakeEmbedder({ [REQ]: [1, 0, 0] }, [0.75, 0.66, 0])
    const r = await scoreSemantic(chunks, jd({ hardSkills: [REQ, 'khác'] }), embedder)

    expect(r.score).toBeGreaterThanOrEqual(0)
    expect(r.score).toBeLessThanOrEqual(100)
    expect(Number.isInteger(r.score)).toBe(true)
  })

  it('embed theo BATCH, không lặp từng cặp', async () => {
    // 3 đoạn × 4 yêu cầu = 12 lượt gọi nếu làm ngây thơ. Phải là 2.
    const spy = vi.fn(async (texts: string[]) => texts.map(() => [1, 0, 0]))
    await scoreSemantic(
      chunks,
      jd({ hardSkills: ['a', 'b'], responsibilities: ['c', 'd'] }),
      { embedBatch: spy },
    )
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('chấm cả `responsibilities`, không chỉ `hardSkills`', async () => {
    const embedder = fakeEmbedder({}, [1, 0, 0])
    const r = await scoreSemantic(
      chunks,
      jd({ hardSkills: ['a'], responsibilities: ['b', 'c'] }),
      embedder,
    )
    expect(r.matches.map((m) => m.requirement)).toEqual(['a', 'b', 'c'])
  })
})

describe('rerank', () => {
  const REQ = 'tối ưu hiệu năng'
  const embedder = fakeEmbedder({
    [REQ]: [1, 0, 0],
    [chunks[0]!.text]: [0.8, 0.6, 0],
    [chunks[1]!.text]: [0.85, 0.53, 0],
    [chunks[2]!.text]: [0.9, 0.44, 0],
  })

  it('reranker đảo lại thứ tự của cosine', async () => {
    const reranker: RerankFn = {
      rerank: async (_q, docs) =>
        // Cố ý đảo ngược để chứng minh thứ tự CUỐI do reranker quyết định
        docs.map((_d, i) => ({ index: docs.length - 1 - i, score: 10 - i })),
    }
    const r = await scoreSemantic(chunks, jd({ hardSkills: [REQ] }), embedder, reranker, {
      rerank: true,
    })

    expect(r.reranked).toBe(true)
    expect(r.matches[0]!.evidence[0]!.rerankScore).toBe(10)
  })

  it('reranker chết → GIỮ thứ tự cosine, mất độ chính xác chứ không mất chức năng', async () => {
    const broken: RerankFn = {
      rerank: async () => {
        throw new Error('HTTP 503')
      },
    }
    const r = await scoreSemantic(chunks, jd({ hardSkills: [REQ] }), embedder, broken, {
      rerank: true,
    })

    expect(r.reranked).toBe(false)
    expect(r.degraded, 'reranker chết KHÔNG phải suy giảm — nó chỉ tinh chỉnh').toBe(false)
    expect(r.matches[0]!.evidence.length).toBeGreaterThan(0)
    expect(r.matches[0]!.evidence[0]!.rerankScore).toBeNull()
  })

  it('reranker chết thì KHÔNG thử lại cho từng yêu cầu còn lại', async () => {
    const spy = vi.fn(async () => {
      throw new Error('HTTP 503')
    })
    await scoreSemantic(
      chunks,
      jd({ hardSkills: ['a', 'b', 'c', 'd', 'e'] }),
      embedder,
      { rerank: spy },
      { rerank: true },
    )
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('điểm logit ÂM vẫn nhận — reranker trả logit, không phải xác suất', async () => {
    const reranker: RerankFn = {
      rerank: async (_q, docs) => docs.map((_d, i) => ({ index: i, score: -2.5 - i })),
    }
    const r = await scoreSemantic(chunks, jd({ hardSkills: [REQ] }), embedder, reranker, {
      rerank: true,
    })
    expect(r.matches[0]!.evidence[0]!.rerankScore).toBe(-2.5)
  })

  it('không bật rerank thì KHÔNG gọi reranker', async () => {
    const spy = vi.fn(async () => [])
    await scoreSemantic(chunks, jd({ hardSkills: [REQ] }), embedder, { rerank: spy })
    expect(spy).not.toHaveBeenCalled()
  })
})
