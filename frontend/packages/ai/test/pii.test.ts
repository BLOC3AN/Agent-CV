import { describe, it, expect } from 'vitest'
import { stripPII, detectPII, assertNoPIIFields } from '../src/pii.js'
import { ProfileSchema, type Profile } from '@hr/schema'

/**
 * TC-SEC-01 · TC-NF-02 — PII guard và nén Profile (TDD §15.2 R1, §6.5)
 */

const sample: Profile = ProfileSchema.parse({
  schemaVersion: 1,
  language: 'vi',
  basics: {
    name: 'Nguyễn Văn An',
    headline: 'Backend Developer',
    email: 'nguyenvanan@gmail.com',
    phone: '0912345678',
    location: 'Số 12, ngõ 5, phố Tạ Quang Bửu, Hà Nội',
    dob: '01/01/2002',
    links: [{ label: 'GitHub', url: 'https://github.com/vanan' }],
    summary: 'Sinh viên năm cuối ngành Kỹ thuật phần mềm.',
  },
  education: [
    {
      school: 'ĐH Bách Khoa Hà Nội',
      degree: 'Kỹ sư',
      major: 'Kỹ thuật phần mềm',
      startDate: '2021',
      endDate: '2025',
      gpa: '3.2',
      highlights: [],
    },
  ],
  work: [
    {
      org: 'Công ty ABC',
      role: 'Thực tập sinh QA',
      startDate: '06/2024',
      endDate: '09/2024',
      highlights: ['Viết 120 test case cho module thanh toán'],
    },
  ],
  projects: [
    {
      name: 'Website thương mại điện tử',
      tech: ['React', 'Node.js', 'PostgreSQL'],
      highlights: ['Giảm thời gian tải trang từ 3.2s xuống 0.8s'],
    },
  ],
  skills: [{ name: 'ReactJS', canonical: 'react' }, { name: 'Node.js' }],
  activities: [],
  certifications: [],
  languages: [],
})

describe('TC-SEC-01 — stripPII loại bỏ toàn bộ PII', () => {
  const compact = stripPII(sample)
  const serialized = JSON.stringify(compact)

  it('không còn họ tên', () => {
    expect(serialized).not.toContain('Nguyễn Văn An')
  })
  it('không còn email', () => {
    expect(serialized).not.toContain('nguyenvanan@gmail.com')
  })
  it('không còn số điện thoại', () => {
    expect(serialized).not.toContain('0912345678')
  })
  it('không còn địa chỉ và ngày sinh', () => {
    // Kiểm tra phần ĐẶC TRƯNG của địa chỉ, không kiểm tra tên thành phố.
    // Lý do: tên thành phố xuất hiện hợp lệ trong tên trường/công ty
    // ("ĐH Bách Khoa Hà Nội") — so khớp chuỗi thô sẽ báo nhầm.
    // Bảo đảm thật nằm ở cấp CẤU TRÚC: field `location` không được mang sang.
    expect(serialized).not.toContain('ngõ 5')
    expect(serialized).not.toContain('Tạ Quang Bửu')
    expect(serialized).not.toContain('01/01/2002')
  })

  it('không mang sang bất kỳ field PII nào (bảo đảm cấp cấu trúc)', () => {
    const keys = new Set(Object.keys(compact))
    for (const k of ['name', 'email', 'phone', 'location', 'dob', 'photo']) {
      expect(keys.has(k)).toBe(false)
    }
  })
  it('detectPII trên chuỗi kết quả không phát hiện gì', () => {
    expect(detectPII(serialized)).toEqual([])
  })
  it('assertNoPIIFields không ném lỗi', () => {
    expect(() => assertNoPIIFields(compact)).not.toThrow()
  })

  it('GIỮ LẠI thông tin cần cho đánh giá', () => {
    // skill dùng `canonical` khi đã chuẩn hoá → "ReactJS" thành "react"
    expect(serialized).toContain('react')
    expect(serialized).toContain('Bách Khoa')
    expect(serialized).toContain('3.2s xuống 0.8s')
    expect(compact.headline).toBe('Backend Developer')
    // CompactProfile rút gọn tên key để tiết kiệm token: tech → t
    expect(compact.proj[0]?.t).toContain('PostgreSQL')
  })

  it('dùng canonical khi đã chuẩn hoá skill', () => {
    expect(compact.skill).toContain('react')
    expect(compact.skill).toContain('Node.js')
  })
})

describe('TC-NF-02 — nén Profile giảm ≥35% ký tự', () => {
  it('CompactProfile nhỏ hơn Profile gốc đáng kể', () => {
    const before = JSON.stringify(sample).length
    const after = JSON.stringify(stripPII(sample)).length
    const saved = 1 - after / before
    expect(saved).toBeGreaterThan(0.35)
  })
})

describe('detectPII — nhận diện PII trong văn bản tự do', () => {
  it('SĐT Việt Nam các đầu số', () => {
    for (const p of ['0912345678', '0387654321', '+84912345678', '0777888999']) {
      expect(detectPII(`Liên hệ ${p}`).some((l) => l.kind === 'phone')).toBe(true)
    }
  })
  it('email', () => {
    expect(detectPII('gửi về a.b+c@sub.domain.vn').some((l) => l.kind === 'email')).toBe(
      true,
    )
  })
  it('ngày sinh', () => {
    expect(detectPII('sinh ngày 15/03/2002').some((l) => l.kind === 'dob')).toBe(true)
  })
  it('văn bản nghiệp vụ sạch không báo nhầm', () => {
    expect(
      detectPII('Tối ưu truy vấn PostgreSQL, giảm từ 4.2s xuống 0.9s trên 200k bản ghi'),
    ).toEqual([])
  })
})

describe('assertNoPIIFields — chốt chặn cấu trúc', () => {
  it('phát hiện field PII còn sót trong object bất kỳ', () => {
    expect(() => assertNoPIIFields({ basics: { email: 'x@y.com' } })).toThrow(/PII_GUARD/)
    expect(() => assertNoPIIFields({ deep: [{ phone: '0912345678' }] })).toThrow(/PII_GUARD/)
  })
  it('field PII rỗng thì không tính', () => {
    expect(() => assertNoPIIFields({ basics: { email: '', phone: null } })).not.toThrow()
  })
})
