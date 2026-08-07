import { describe, it, expect } from 'vitest'
import { allowedFieldsAt, SkillSchema, WorkSchema } from '../src/index.js'

/**
 * `allowedFieldsAt` — nguồn duy nhất cho lời nhắc "chỗ này có field nào".
 *
 * Vì sao phải suy ra từ schema chứ không viết tay danh sách: lời nhắc này được
 * gửi cho model ở lượt sửa (chat-flow §8.3.14). Viết tay thì lần sau thêm một
 * field vào `SkillSchema` là lời nhắc thành sai, và model bị dạy sai một cách
 * im lặng — không test nào đỏ.
 */

describe('allowedFieldsAt', () => {
  it('phần tử của mục → đúng field của schema mục đó', () => {
    const skill = allowedFieldsAt('/skills/0')
    expect(skill?.fields).toEqual(Object.keys(SkillSchema.shape))
    expect(skill?.label).toContain('kỹ năng')

    const work = allowedFieldsAt('/work/2')
    expect(work?.fields).toEqual(Object.keys(WorkSchema.shape))
    expect(work?.label).toContain('chỗ làm')
  })

  it('KHÔNG lẫn field giữa các mục', () => {
    // Đây chính là lỗi đã xảy ra: model đưa `tech`/`highlights` của dự án vào
    // một kỹ năng, vì CvItemSchema gộp field mọi mục nên grammar cho phép.
    expect(allowedFieldsAt('/skills/0')!.fields).not.toContain('tech')
    expect(allowedFieldsAt('/skills/0')!.fields).not.toContain('highlights')
    expect(allowedFieldsAt('/projects/0')!.fields).toContain('tech')
    expect(allowedFieldsAt('/work/0')!.fields).toContain('highlights')
  })

  it('"/-" cũng là một phần tử — dùng khi thêm vào cuối mảng', () => {
    expect(allowedFieldsAt('/activities/-')?.fields).toEqual(
      allowedFieldsAt('/activities/0')?.fields,
    )
  })

  it('/basics là object, có bộ field riêng', () => {
    const b = allowedFieldsAt('/basics')
    expect(b?.fields).toContain('summary')
    expect(b?.fields).toContain('headline')
  })

  it('null ở chỗ không phải object có schema cố định', () => {
    // chuỗi bên trong mảng, cả mảng, mục không tồn tại, gốc hồ sơ
    for (const p of ['/work/0/highlights/1', '/skills', '/khong-co/0', '', '/']) {
      expect(allowedFieldsAt(p)).toBeNull()
    }
  })

  it('mọi mục của Profile đều tra được — không mục nào rơi ra ngoài', () => {
    for (const s of [
      'education',
      'work',
      'projects',
      'skills',
      'activities',
      'certifications',
      'languages',
    ]) {
      const r = allowedFieldsAt(`/${s}/0`)
      expect(r, s).not.toBeNull()
      expect(r!.fields.length, s).toBeGreaterThan(0)
      expect(r!.label, s).not.toBe('')
    }
  })
})
