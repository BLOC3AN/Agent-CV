import { describe, it, expect } from 'vitest'
import { bodyPrompt, buildProfile, nextStage, previousStage, type GuidedAnswers } from '@/lib/guided'

/**
 * TC-05-01..05 — luồng làm CV từ đầu có người dẫn. UC-05.
 *
 * Người chưa từng viết CV nhìn thấy form 30 ô sẽ đóng tab; nhìn thấy mục
 * "Kinh nghiệm" trống trơn sẽ kết luận mình không đủ tư cách rồi bỏ.
 */

const a = (over: GuidedAnswers = {}): GuidedAnswers => over

describe('nextStage — TC-05-01 một cụm mỗi bước', () => {
  it('đi đúng thứ tự, không nhảy cóc', () => {
    expect(nextStage(a())).toBe('situation')
    expect(nextStage(a({ situation: 'student' }))).toBe('target')
    expect(nextStage(a({ situation: 'student', target: 'CV Engineer' }))).toBe('experience')
  })

  it('trả lời "chưa đi làm" vẫn đi tiếp — KHÔNG phải ngõ cụt', () => {
    const s = nextStage(a({ situation: 'student', target: 'X', hasWorked: false }))
    expect(s).toBe('body')
  })

  it('đủ thông tin → null, tức là dựng được hồ sơ', () => {
    expect(
      nextStage(a({ situation: 'fresher', target: 'X', hasWorked: true, bodyTitle: 'Dev', name: 'A' })),
    ).toBeNull()
  })

  it('ô trắng toàn khoảng trắng không tính là đã trả lời', () => {
    expect(nextStage(a({ situation: 'student', target: '   ' }))).toBe('target')
  })
})

describe('previousStage — TC-05-01 luôn có nút quay lại', () => {
  it('mọi bước trừ bước đầu đều quay lại được', () => {
    expect(previousStage('situation')).toBeNull()
    expect(previousStage('target')).toBe('situation')
    expect(previousStage('body')).toBe('experience')
    expect(previousStage('contact')).toBe('body')
  })
})

describe('TC-05-03 "chưa đi làm" ĐỔI HƯỚNG, không phải lỗi của họ', () => {
  it('lời dẫn nói rõ dự án mới là phần được đọc kỹ', () => {
    const p = bodyPrompt(a({ hasWorked: false }))
    // Sinh viên nhìn mục Kinh nghiệm trống sẽ kết luận mình không đủ tư cách
    expect(p.lead).toMatch(/Không sao/)
    expect(p.lead).toMatch(/Dự án/)
    expect(p.labelTitle).toMatch(/dự án/i)
  })

  it('KHÔNG dùng chữ mang nghĩa thiếu sót', () => {
    const p = bodyPrompt(a({ hasWorked: false }))
    expect(p.lead).not.toMatch(/thiếu|chưa đủ|đáng tiếc|rất tiếc/i)
  })

  it('đã đi làm thì hỏi về công việc', () => {
    const p = bodyPrompt(a({ hasWorked: true }))
    expect(p.labelOrg).toMatch(/Công ty/)
  })
})

describe('buildProfile — TC-05-05 KHÔNG bịa nội dung thay người dùng', () => {
  const full = (over: GuidedAnswers = {}): GuidedAnswers => ({
    situation: 'student',
    target: 'Computer Vision Engineer',
    hasWorked: false,
    bodyTitle: 'Đồ án nhận diện biển số',
    bodyOrg: 'Đồ án môn học',
    bodyHighlight: 'Huấn luyện YOLOv8 đạt 92% chính xác',
    name: 'Trần Hoàng Nam',
    email: 'nam@example.com',
    ...over,
  })

  it('chưa đi làm → nội dung vào DỰ ÁN, mục kinh nghiệm không bị bỏ trống hình thức', () => {
    const p = buildProfile(full())
    expect(p.projects?.[0]?.name).toBe('Đồ án nhận diện biển số')
    expect(p.work ?? []).toHaveLength(0)
  })

  it('đã đi làm → nội dung vào KINH NGHIỆM', () => {
    const p = buildProfile(full({ hasWorked: true, bodyTitle: 'Thực tập sinh', bodyOrg: 'Cty X' }))
    expect(p.work?.[0]?.org).toBe('Cty X')
    expect(p.work?.[0]?.role).toBe('Thực tập sinh')
    expect(p.projects ?? []).toHaveLength(0)
  })

  it('vị trí nhắm tới thành chức danh trên CV', () => {
    expect(buildProfile(full()).basics?.headline).toBe('Computer Vision Engineer')
  })

  it('mọi chữ trong hồ sơ đều do NGƯỜI DÙNG gõ', () => {
    const p = buildProfile(full())
    const text = JSON.stringify(p)
    for (const s of ['Trần Hoàng Nam', 'Computer Vision Engineer', 'YOLOv8']) {
      expect(text).toContain(s)
    }
    // Không có mẫu câu nào tự sinh thêm
    expect(text).not.toMatch(/năng động|nhiệt huyết|chăm chỉ|ham học hỏi/i)
  })

  it('bỏ trống phần không bắt buộc thì không sinh ra chuỗi rỗng vô nghĩa', () => {
    const p = buildProfile(full({ email: '', bodyHighlight: '' }))
    expect(p.basics?.email).toBeUndefined()
    expect(p.projects?.[0]?.highlights).toEqual([])
  })
})
