import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ProfileSchema } from '../src/profile.js'
import { CVSchema, type CV } from '../src/cv.js'
import { profileToCV, cvToProfile } from '../src/cv-migrate.js'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

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

describe('khứ hồi v1 → v2 → v1', () => {
  const files = readdirSync(FIXTURES).filter((f) => f.endsWith('.json'))

  it('có fixture để chạy', () => {
    expect(files.length).toBeGreaterThanOrEqual(4)
  })

  it.each(files)('%s khôi phục nguyên trạng', (file) => {
    const original = ProfileSchema.parse(
      JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')),
    )
    const restored = cvToProfile(profileToCV(original, META))
    // toStrictEqual, không toEqual: đây là chốt cho phép chạy backfill trên dữ
    // liệu thật, và toEqual coi { a: undefined } bằng {} — lỏng hơn mức chốt
    // này cần.
    expect(restored).toStrictEqual(original)
  })

  // profile-v1-full.json chỉ lộ ca này qua đúng một field (work[1].endDate).
  // Test riêng này phủ hết các field optional-string còn lại có cùng bệnh: v2
  // dùng `.default('')` nên "field rỗng tường minh" và "field vắng mặt" đổ về
  // cùng một '' — nếu bất kỳ dòng restoreEmpty() nào trong cvToProfile() bị
  // xoá (quay lại `x.field ? {...} : {}` đơn thuần), field tương ứng ở đây sẽ
  // rụng khỏi kết quả và test lệch. Gồm cả `dob`/`photo`/`education.major`/
  // `education.gpa`/`skills.canonical`/`skills.group`: những field này KHÔNG
  // dùng v2 default(''), nhưng cùng bị mất vì chiều lùi dùng kiểm tra truthy
  // trên một giá trị đã lưu đúng là '' (round 1 review, finding 1).
  it('field optional-string rỗng tường minh khứ hồi đúng, không lẫn với field vắng mặt', () => {
    const original = ProfileSchema.parse({
      schemaVersion: 1,
      language: 'vi',
      basics: {
        name: 'Rỗng Tường Minh',
        headline: '',
        introduce: '',
        phone: '',
        location: '',
        dob: '',
        photo: '',
        links: [],
      },
      education: [{ school: 'X', degree: 'Y', major: '', gpa: '', startDate: '', endDate: '' }],
      work: [{ org: 'O', role: 'R', startDate: '', endDate: '' }],
      projects: [{ name: 'P', role: '', startDate: '', endDate: '' }],
      skills: [{ name: 'S1', canonical: '', group: '' }],
      activities: [{ name: 'A', role: '', period: '' }],
      certifications: [{ name: 'C', issuer: '', date: '' }],
      languages: [{ name: 'L', level: '' }],
      _meta: { verified: {}, source: 'manual' },
    })
    const restored = cvToProfile(profileToCV(original, META))
    expect(restored).toStrictEqual(original)
  })
})

describe('cvToProfile ném lỗi rõ ràng thay vì khôi phục một phần trong im lặng', () => {
  // Đây là đường lùi cho backfill trên dữ liệu thật: một tài liệu v2 không do
  // profileToCV() sinh ra (hoặc bị chỉnh sửa mất _meta) mà cứ âm thầm trả về
  // hồ sơ rỗng kỹ năng là failure mode tệ nhất — người vận hành tưởng dữ liệu
  // nguyên vẹn.
  const baseCV = {
    schemaVersion: 2 as const,
    id: 'cv-thieu-bang-tra',
    title: 'T',
    lastModified: '2026-08-09T10:00:00Z',
    language: 'vi' as const,
    sections: {
      intro: { fullName: 'Ai đó' },
      skills: [{ id: 'skill-0', category: 'Ngôn ngữ', skills: ['Python'] }],
    },
    _meta: { verified: {}, source: 'manual' as const, originalLinks: [], droppedFields: {}, canonical: {} },
  }

  it('ném lỗi kèm id CV khi sections.skills không rỗng nhưng /skills/_order thiếu', () => {
    const cv = CVSchema.parse(baseCV)
    expect(() => cvToProfile(cv)).toThrow(/cv-thieu-bang-tra/)
  })

  // Task 4 đọc JSON thẳng từ storage, không phải một CV đã được TypeScript
  // đảm bảo hình dạng — validate lại ở entry để tài liệu hỏng báo lỗi schema
  // rõ ràng, không phải TypeError mù mờ khi code bên dưới đọc field của
  // undefined.
  it('ném lỗi schema rõ ràng khi input không phải CV hợp lệ, không phải TypeError mù mờ', () => {
    const malformed = { khong_phai: 'mot CV hop le' } as unknown as CV
    expect(() => cvToProfile(malformed)).not.toThrow(TypeError)
    expect(() => cvToProfile(malformed)).toThrow()
  })

  it('ném lỗi kèm id CV khi một con trỏ trong /skills/_order không khớp sections.skills', () => {
    const cv = CVSchema.parse({
      ...baseCV,
      id: 'cv-bang-tra-loi-thoi',
      _meta: {
        ...baseCV._meta,
        // Trỏ tới nhóm kỹ năng thứ 9 — không tồn tại, chỉ có nhóm 0.
        droppedFields: { '/skills/_order': JSON.stringify(['/sections/skills/9/skills/0']) },
      },
    })
    expect(() => cvToProfile(cv)).toThrow(/cv-bang-tra-loi-thoi/)
  })
})

describe('_meta.verified trên bullet dự án không được đáp nhầm vào dòng "Công nghệ: …" máy sinh', () => {
  // Round-trip không thấy được lỗi này: cả hai chiều đều lệch giống nhau nên
  // v1→v2→v1 vẫn khớp trong khi v2 (tài liệu THẬT SỰ được lưu và hiển thị)
  // đã sai. Phải assert trực tiếp trên tài liệu v2 trung gian.
  it('bullet gốc đầu tiên của project có tech dịch sang highlights[1], không phải highlights[0]', () => {
    const v1WithTech = ProfileSchema.parse({
      schemaVersion: 1,
      language: 'vi',
      basics: { name: 'A' },
      projects: [
        { name: 'X', tech: ['Go', 'Rust'], highlights: ['Bullet gốc đầu tiên', 'Bullet gốc thứ hai'] },
      ],
      _meta: { verified: { '/projects/0/highlights/0': true } },
    })
    const cv = profileToCV(v1WithTech, META)

    // highlights[0] là dòng máy sinh "Công nghệ: …"; bullet gốc đầu tiên bị đẩy sang [1].
    expect(cv.sections.projects[0]!.highlights).toEqual([
      'Công nghệ: Go, Rust',
      'Bullet gốc đầu tiên',
      'Bullet gốc thứ hai',
    ])
    // Dấu xác nhận của người dùng phải đáp đúng bullet gốc, không phải dòng máy sinh.
    expect(cv._meta.verified['/sections/projects/0/highlights/1']).toBe(true)
    expect(cv._meta.verified['/sections/projects/0/highlights/0']).toBeUndefined()
  })

  it('khứ hồi lại đúng v1 pointer gốc từ v2 pointer đã lệch', () => {
    const v1WithTech = ProfileSchema.parse({
      schemaVersion: 1,
      language: 'vi',
      basics: { name: 'A' },
      projects: [{ name: 'X', tech: ['Go'], highlights: ['Bullet gốc'] }],
      _meta: { verified: { '/projects/0/highlights/0': true } },
    })
    const restored = cvToProfile(profileToCV(v1WithTech, META))
    expect(restored._meta.verified['/projects/0/highlights/0']).toBe(true)
  })

  it('project KHÔNG có tech thì không lệch chỉ số (không có dòng máy sinh để chèn)', () => {
    const v1NoTech = ProfileSchema.parse({
      schemaVersion: 1,
      language: 'vi',
      basics: { name: 'A' },
      projects: [{ name: 'X', highlights: ['Bullet gốc'] }],
      _meta: { verified: { '/projects/0/highlights/0': true } },
    })
    const cv = profileToCV(v1NoTech, META)
    expect(cv.sections.projects[0]!.highlights).toEqual(['Bullet gốc'])
    expect(cv._meta.verified['/sections/projects/0/highlights/0']).toBe(true)
  })
})

describe('con trỏ nguyên mục (bare pointer) trong _meta.verified — Finding 5', () => {
  // Bug thật, gây mất dữ liệu trên 3 hồ sơ thật: review.ts phát `/skills` trơn
  // khi người dùng xác nhận nguyên mục kỹ năng (UC-22). Trước bản vá,
  // `/skills` không được dịch ở CẢ HAI CHIỀU theo cùng kiểu lệch nhau, nên một
  // test chỉ nhìn kết quả khứ hồi (v1→v2→v1) sẽ không lộ ra — giống hệt lỗi
  // lệch chỉ số "Công nghệ: …" ở review trước. Phải assert trên tài liệu v2
  // trung gian, không chỉ khứ hồi.
  it('/skills trơn dịch sang /sections/skills ở tài liệu v2 trung gian', () => {
    const v1Skills = ProfileSchema.parse({
      schemaVersion: 1,
      language: 'vi',
      basics: { name: 'A' },
      skills: [{ name: 'Python', group: 'Ngôn ngữ' }],
      _meta: { verified: { '/skills': true } },
    })
    const cv = profileToCV(v1Skills, META)
    expect(cv._meta.verified['/sections/skills']).toBe(true)

    const restored = cvToProfile(cv)
    expect(restored._meta.verified['/skills']).toBe(true)
  })

  // Audit toàn bộ mục: `basics` đã có nhánh riêng từ trước (luôn đúng);
  // `education/work/projects/activities/certifications/languages` đi qua bảng
  // `section` dùng chung nên con trỏ trơn tự nhiên đúng qua nhánh đó; chỉ
  // `skills` bị loại khỏi bảng `section` (cần bảng tra riêng cho từng phần
  // tử) nên là mục DUY NHẤT cần vá riêng — vá ở trên. Test này chứng minh cả
  // tám mục đều khứ hồi đúng con trỏ trơn, không chỉ khẳng định bằng lời.
  const SECTIONS = [
    'basics', 'education', 'work', 'projects',
    'skills', 'activities', 'certifications', 'languages',
  ] as const

  it.each(SECTIONS)('con trỏ nguyên mục /%s khứ hồi đúng', (section) => {
    const v1Bare = ProfileSchema.parse({
      schemaVersion: 1,
      language: 'vi',
      basics: { name: 'A' },
      _meta: { verified: { [`/${section}`]: true } },
    })
    const restored = cvToProfile(profileToCV(v1Bare, META))
    expect(restored._meta.verified[`/${section}`]).toBe(true)
  })
})

describe('_meta.verified: pointer không dịch được không được vứt trong im lặng — Finding 6', () => {
  // Cơ chế "không dịch được thì biến mất trong im lặng" chính là nguyên nhân
  // của bug /skills ở Finding 5. Vá riêng /skills không chặn được pointer lạ
  // TIẾP THEO mà translateVerifiedPointer() chưa từng gặp — phải chặn ở gốc:
  // giữ lại pointer không dịch được, không vứt.
  it('pointer lạ (/nonexistent/0) không bị vứt trong im lặng — sống sót qua khứ hồi', () => {
    const v1Unknown = ProfileSchema.parse({
      schemaVersion: 1,
      language: 'vi',
      basics: { name: 'A' },
      _meta: { verified: { '/nonexistent/0': true } },
    })
    const cv = profileToCV(v1Unknown, META)

    // Không có v2 pointer hợp lệ cho nó (đúng — không nên có), nhưng nó phải
    // để lại DẤU VẾT có thể đọc lại được, không phải biến mất hoàn toàn.
    expect(cv._meta.verified['/nonexistent/0']).toBeUndefined()
    expect(cv._meta.droppedFields['/_meta/verified/nonexistent/0']).toBe('true')

    const restored = cvToProfile(cv)
    expect(restored._meta.verified['/nonexistent/0']).toBe(true)
  })

  it('giá trị false của pointer lạ cũng khứ hồi đúng, không mặc định thành true', () => {
    const v1UnknownFalse = ProfileSchema.parse({
      schemaVersion: 1,
      language: 'vi',
      basics: { name: 'A' },
      _meta: { verified: { '/nonexistent/1': false } },
    })
    const restored = cvToProfile(profileToCV(v1UnknownFalse, META))
    expect(restored._meta.verified['/nonexistent/1']).toBe(false)
  })
})
