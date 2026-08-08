import { describe, it, expect } from 'vitest'
import { chunkSection } from '../src/cv-chunk.js'

/**
 * Chia mục thành từng chỗ làm — TDD §6.4 bước 5.
 *
 * Điều kiện KHÔNG ĐƯỢC PHÁ: chia xong phải giữ đủ chữ. Mục đích của việc chia là
 * lấy được ĐỦ nội dung; một cách chia làm rơi chữ thì tệ hơn không chia.
 */

const flat = (s: string): string => s.replace(/\s+/g, '')

/** Ghép các khúc lại, bỏ tiêu đề mục bị lặp ở đầu khúc thứ hai trở đi */
function rejoin(chunks: string[], heading: string): string {
  const head = flat(heading)
  return chunks.reduce((acc, c, i) => {
    const f = flat(c)
    return acc + (i > 0 && f.startsWith(head) ? f.slice(head.length) : f)
  }, '')
}

const WORK = `EXPERIENCE
iMESPRO
AI Engineer
December, 2025 – Current
• Thiết kế kiến trúc 11 microservice cho nền tảng iVision MLOps, dựng lớp lưu
trữ phân tán MinIO và RBAC theo phiên cho nhiều tenant.
• Dẫn dắt Edge AI trên Jetson Orin Nano, Rockchip RV1106; cài Knowledge
Distillation để nén YOLO thành mô hình tí hon chạy 5–10 FPS.
bTaskee
AI Engineer
Jun, 2025 – December, 2025
• Triển khai LLM Qwen3, Gemini, OpenAI trên vLLM cho suy luận hiệu năng cao.
• Ghép RAG với tìm kiếm lai trên Weaviate và Qdrant, thời gian phản hồi dưới 3s.
STK_ENG – KANEKO SANGYO
AI Engineer
May, 2024 – Jun, 2025
• Xây mô hình LightGBM, XGBoost, LSTM để dự đoán momen xoắn van điện từ.
• Dựng pipeline tiền xử lý Polars, Pandas cho tập dữ liệu cảm biến 2 triệu dòng.
ZALO - VNG CORPORATION
AI Engineer
September, 2022 – August, 2023
• Gán nhãn giọng nói, tiếng ồn, face id, EKYC, OCR cho hơn 15 dự án.
REALTIME ROBOTIC VIETNAM
Intern AI Engineer
January, 2022 – May, 2022
• Xử lý ảnh số bằng OpenCV trong 3 dự án.
`

describe('chunkSection', () => {
  it('mục ngắn: một khúc, không đụng gì', () => {
    const short = 'SKILLS\nPython, PyTorch, Docker'
    expect(chunkSection(short)).toEqual([short])
  })

  it('mục dài: chia thành nhiều khúc, mỗi khúc trong hạn mức', () => {
    const chunks = chunkSection(WORK, 600)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) {
      // Một chỗ làm dài hơn hạn mức thì đứng riêng — không cắt giữa nó
      expect(c.length).toBeLessThanOrEqual(Math.max(600, 900))
    }
  })

  it('KHÔNG mất chữ nào sau khi chia', () => {
    for (const max of [400, 600, 900, 1_500]) {
      const chunks = chunkSection(WORK, max)
      expect(rejoin(chunks, 'EXPERIENCE')).toBe(flat(WORK))
    }
  })

  it('mỗi khúc mở đầu bằng một chỗ làm, không phải đuôi câu', () => {
    const chunks = chunkSection(WORK, 600)
    for (const c of chunks) {
      const lines = c.split('\n').filter((l) => l.trim())
      // dòng đầu là tiêu đề mục, dòng thứ hai phải là tên chỗ làm
      expect(lines[0]).toBe('EXPERIENCE')
      expect(lines[1]).toMatch(
        /^(iMESPRO|bTaskee|STK_ENG – KANEKO SANGYO|ZALO - VNG CORPORATION|REALTIME ROBOTIC VIETNAM)$/,
      )
    }
  })

  it('tiêu đề mục có ở MỌI khúc — model phải biết đang đọc mục gì', () => {
    for (const c of chunkSection(WORK, 600)) {
      expect(c.startsWith('EXPERIENCE')).toBe(true)
    }
  })

  it('không cắt một chỗ làm ra làm hai', () => {
    const chunks = chunkSection(WORK, 600)
    const withKaneko = chunks.filter((c) => c.includes('KANEKO'))
    expect(withKaneko).toHaveLength(1)
    expect(withKaneko[0]).toContain('momen xoắn van điện từ')
    expect(withKaneko[0]).toContain('2 triệu dòng')
  })

  it('nhận cả dấu đầu dòng ● (U+25CF) — CV xuất từ DOCX dùng ký tự này', () => {
    const text =
      'WORK EXPERIENCE\n' +
      'iTechwx Company Limited\n5/2025 – Present\nCustomer Support Engineer\n' +
      '●​ Xử lý sự cố khách hàng, đạt 95% giải quyết ngay lần đầu.\n' +
      'Vietnam Concentrix Services\n3/2024 – 4/2025\nGuest Specialist\n' +
      '●​ Trả lời hơn 30 yêu cầu mỗi ngày, CSAT 80%.\n'
    const chunks = chunkSection(text, 200)
    expect(chunks.length).toBe(2)
    expect(chunks[0]).toContain('iTechwx')
    expect(chunks[1]).toContain('Concentrix')
  })

  it('đuôi câu bị ngắt dòng KHÔNG mở khúc mới', () => {
    /*
     * HỒI QUY: "and health tracking of production workloads." là đuôi của gạch
     * đầu dòng phía trên, nhưng nó ngắn và có mốc thời gian ở vài dòng sau nên
     * từng bị nhận là tên chỗ làm mới → khúc mở đầu bằng nửa câu.
     */
    const text =
      'EXPERIENCE\nFPT Software\n2024 – 2025\n' +
      '• Dựng hệ giám sát huấn luyện dùng Redis Pub/Sub và WebSocket, gộp log\n' +
      'and health tracking of production workloads.\n' +
      'bTaskee\n2025 – 2026\n• Triển khai LLM trên vLLM.\n'
    const chunks = chunkSection(text, 120)
    // Đuôi câu phải Ở LẠI với chỗ làm của nó, không mở khúc riêng
    for (const c of chunks) {
      const second = c.split('\n').filter((l) => l.trim())[1]
      expect(second).not.toMatch(/^and health tracking/)
    }
    expect(chunks.find((c) => c.includes('and health tracking'))).toContain('FPT Software')
    expect(chunks.some((c) => c.includes('bTaskee'))).toBe(true)
  })

  it('không nhận ra ranh giới thì trả nguyên khối, không cắt bừa', () => {
    // Một đoạn văn xuôi dài, không mốc thời gian, không dấu đầu dòng
    const prose = 'GIỚI THIỆU\n' + 'câu văn dài không có mốc thời gian nào cả. '.repeat(40)
    const chunks = chunkSection(prose, 300)
    expect(chunks).toEqual([prose.trim()])
  })
})
