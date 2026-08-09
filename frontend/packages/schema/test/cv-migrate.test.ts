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

  it('education: dịch major → fieldOfStudy', () => {
    const edu = profileToCV(v1, META).sections.education[0]
    expect(edu?.fieldOfStudy).toBe('Cơ điện tử')
    expect(edu?.school).toBe('HCMUTE')
    expect(edu?.degree).toBe('Kỹ sư')
  })

  it('activities: dịch name → organization, period → startDate', () => {
    const v1Activity = ProfileSchema.parse({
      schemaVersion: 1,
      language: 'vi',
      basics: { name: 'A' },
      activities: [{ name: 'Hội Điện Tử', role: 'Chủ nhiệm', period: '2022-2023', highlights: ['Tổ chức hội thảo'] }],
    })
    const act = profileToCV(v1Activity, META).sections.activities[0]
    expect(act?.organization).toBe('Hội Điện Tử')
    expect(act?.role).toBe('Chủ nhiệm')
    expect(act?.startDate).toBe('2022-2023')
  })

  it('certifications: không thay đổi name, dịch issuer', () => {
    const v1Cert = ProfileSchema.parse({
      schemaVersion: 1,
      language: 'vi',
      basics: { name: 'A' },
      certifications: [{ name: 'AWS Solutions Architect', issuer: 'Amazon', date: '2023-06' }],
    })
    const cert = profileToCV(v1Cert, META).sections.certifications[0]
    expect(cert?.name).toBe('AWS Solutions Architect')
    expect(cert?.issuer).toBe('Amazon')
    expect(cert?.date).toBe('2023-06')
  })

  it('languages: dịch name → language, level → proficiency', () => {
    const v1Lang = ProfileSchema.parse({
      schemaVersion: 1,
      language: 'vi',
      basics: { name: 'A' },
      languages: [{ name: 'English', level: 'TOEIC 900' }],
    })
    const lang = profileToCV(v1Lang, META).sections.languages[0]
    expect(lang?.language).toBe('English')
    expect(lang?.proficiency).toBe('TOEIC 900')
  })

  it('cất tech của dự án trong _meta.droppedFields dưới dạng JSON, không chỉ trong prose', () => {
    const dropped = profileToCV(v1, META)._meta.droppedFields
    expect(dropped['/projects/0/tech']).toBe(JSON.stringify(['Go', 'ONNX']))
  })

  it('/skills/N verified pointer được dịch qua bảng grouping', () => {
    const v1Skills = ProfileSchema.parse({
      schemaVersion: 1,
      language: 'vi',
      basics: { name: 'A' },
      skills: [
        { name: 'Python', group: 'Programming' },
        { name: 'JavaScript', group: 'Programming' },
        { name: 'Docker', group: 'MLOps' },
      ],
      _meta: { verified: { '/skills/2': true } },
    })
    const verified = profileToCV(v1Skills, META)._meta.verified
    // skills[2] là Docker (thứ 0 trong MLOps), nên v2 pointer là /sections/skills/1/skills/0
    expect(verified['/sections/skills/1/skills/0']).toBe(true)
  })

  it('kỹ năng không có group và kỹ năng với group="Khác" phải phân biệt được', () => {
    const v1NoGroup = ProfileSchema.parse({
      schemaVersion: 1,
      language: 'vi',
      basics: { name: 'A' },
      skills: [
        { name: 'NoGroup' }, // group is undefined
        { name: 'Khac', group: 'Khác' }, // group is literally "Khác"
      ],
    })
    const dropped = profileToCV(v1NoGroup, META)._meta.droppedFields
    // skills[1] có group="Khác" → được ghi lại
    expect(dropped['/skills/1/group']).toBe('Khác')
    // skills[0] không có group → không được ghi lại
    expect(dropped['/skills/0/group']).toBeUndefined()
  })

  it('education verified pointer được dịch', () => {
    const v1Edu = ProfileSchema.parse({
      schemaVersion: 1,
      language: 'vi',
      basics: { name: 'A' },
      education: [{ school: 'ĐH Bách Khoa', degree: 'Kỹ sư' }],
      _meta: { verified: { '/education/0/school': true } },
    })
    const verified = profileToCV(v1Edu, META)._meta.verified
    expect(verified['/sections/education/0/school']).toBe(true)
    expect(verified['/education/0/school']).toBeUndefined()
  })

  it('kỹ năng với group lồng nhau (interleaved) lưu thứ tự v1 trong /skills/_order', () => {
    const v1Interleaved = ProfileSchema.parse({
      schemaVersion: 1,
      language: 'vi',
      basics: { name: 'A' },
      skills: [
        { name: 'Python', group: 'Ngôn ngữ' },      // v1 index 0
        { name: 'Docker', group: 'MLOps' },          // v1 index 1
        { name: 'Go', group: 'Ngôn ngữ' },           // v1 index 2
      ],
    })
    const cv = profileToCV(v1Interleaved, META)
    const dropped = cv._meta.droppedFields

    // Xác nhận v2 grouping: [Ngôn ngữ: Python, Go], [MLOps: Docker]
    expect(cv.sections.skills.map((s) => s.category)).toEqual(['Ngôn ngữ', 'MLOps'])
    expect(cv.sections.skills[0]!.skills).toEqual(['Python', 'Go'])
    expect(cv.sections.skills[1]!.skills).toEqual(['Docker'])

    // Quan trọng: /skills/_order cho phép khôi phục thứ tự v1 và canh chỉnh level/group
    const order = JSON.parse(dropped['/skills/_order']!)
    // v1 index 0 (Python) → v2 /sections/skills/0/skills/0
    expect(order[0]).toBe('/sections/skills/0/skills/0')
    // v1 index 1 (Docker) → v2 /sections/skills/1/skills/0
    expect(order[1]).toBe('/sections/skills/1/skills/0')
    // v1 index 2 (Go) → v2 /sections/skills/0/skills/1
    expect(order[2]).toBe('/sections/skills/0/skills/1')

    // Nếu xoá dòng `droppedFields['/skills/_order'] = ...` thì test này fail
    // (not a string khi gọi JSON.parse trên undefined)
  })
})
