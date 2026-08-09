import { describe, it, expect } from 'vitest'
import { ProfileSchema } from '../src/profile.js'
import { profileToCV } from '../src/cv-migrate.js'

const META = { id: 'cv-1', title: 'CV của tôi', lastModified: '2026-08-09T10:00:00Z' }

const v1 = ProfileSchema.parse({
  schemaVersion: 1,
  language: 'vi',
  basics: {
    name: 'Nguyễn Văn A',
    headline: 'Kỹ sư AI',
    introduce: 'Ba năm làm edge AI',
    email: 'a@example.com',
    phone: '0901234567',
    location: 'Hà Nội',
    dob: '1999-01-02',
    photo: 'https://cdn.example/a.jpg',
    links: [
      { label: 'GitHub', url: 'https://github.com/a' },
      { label: 'Blog', url: 'https://a.dev' },
    ],
  },
  work: [{ org: 'FPT', role: 'Engineer', type: 'fulltime', startDate: '2023-01', highlights: ['Giảm 40% độ trễ'] }],
  projects: [{ name: 'Cân AI', tech: ['Go', 'ONNX'], url: 'https://x.dev', highlights: ['Chạy trên Jetson'] }],
  education: [{ school: 'HCMUTE', degree: 'Kỹ sư', major: 'Cơ điện tử' }],
  skills: [
    { name: 'Python', group: 'Programming', canonical: 'python', level: 'advanced' },
    { name: 'Go', group: 'Programming', canonical: 'golang' },
    { name: 'Docker', group: 'MLOps', canonical: 'docker' },
  ],
  _meta: { verified: { '/basics/name': true, '/work/0/highlights/0': true }, source: 'pdf_import' },
})

describe('profileToCV', () => {
  it('đổi tên field của intro', () => {
    const intro = profileToCV(v1, META).sections.intro
    expect(intro.fullName).toBe('Nguyễn Văn A')
    expect(intro.title).toBe('Kỹ sư AI')
    expect(intro.summary).toBe('Ba năm làm edge AI')
    expect(intro.avatarUrl).toBe('https://cdn.example/a.jpg')
  })

  it('lấy link đầu làm website và giữ NGUYÊN CẢ MẢNG trong _meta', () => {
    const cv = profileToCV(v1, META)
    expect(cv.sections.intro.website).toBe('https://github.com/a')
    // Cả mảng, không phải phần dư: nhãn 'GitHub' của link đầu cũng không có chỗ
    // ở v2, giữ thiếu là khứ hồi phải đoán nhãn và đoán sai.
    expect(cv._meta.originalLinks).toEqual([
      { label: 'GitHub', url: 'https://github.com/a' },
      { label: 'Blog', url: 'https://a.dev' },
    ])
  })

  it('cất mọi field v1 không có chỗ ở v2 vào droppedFields, khoá là JSON Pointer', () => {
    const dropped = profileToCV(v1, META)._meta.droppedFields
    expect(dropped['/basics/dob']).toBe('1999-01-02')
    // work[].type và skills[].level cũng không có chỗ ở v2. Bỏ sót chúng thì
    // test khứ hồi ở Task 3 đỏ, và đó là chỗ duy nhất phát hiện ra.
    expect(dropped['/work/0/type']).toBe('fulltime')
    expect(dropped['/skills/0/level']).toBe('advanced')
  })

  it('gom skills theo group và giữ canonical trong _meta', () => {
    const cv = profileToCV(v1, META)
    expect(cv.sections.skills.map((s) => s.category)).toEqual(['Programming', 'MLOps'])
    expect(cv.sections.skills[0]!.skills).toEqual(['Python', 'Go'])
    expect(cv._meta.canonical).toEqual({ Python: 'python', Go: 'golang', Docker: 'docker' })
  })

  it('gộp tech của dự án vào bullet đầu tiên', () => {
    expect(profileToCV(v1, META).sections.projects[0]!.highlights[0]).toBe('Công nghệ: Go, ONNX')
  })

  it('DỊCH khoá JSON Pointer của _meta.verified, không copy', () => {
    const verified = profileToCV(v1, META)._meta.verified
    expect(verified['/sections/intro/fullName']).toBe(true)
    expect(verified['/sections/experience/0/highlights/0']).toBe(true)
    expect(verified['/basics/name']).toBeUndefined()
  })
})
