import { describe, it, expect } from 'vitest'
import { redactPII, redactSections, identityFromMap } from '../src/redact.js'

/**
 * Test cho lớp che PII — TDD §15.2 R1.
 *
 * Đây là RANH GIỚI TIN CẬY: text đi qua đây rồi mới tới model, và gửi PII đi
 * rồi thì không rút lại được. Bỏ sót ở đây là sự cố dữ liệu cá nhân, không
 * phải lỗi hiển thị.
 *
 * Fixture là dữ liệu TỔNG HỢP có cùng HÌNH DẠNG với 6 CV thật trong `eval/cv`
 * (gitignored). Không bao giờ đưa PII thật vào file được commit.
 */

describe('số điện thoại — 6 cách viết gặp trong CV thật', () => {
  // HỒI QUY: bản đầu đòi chữ số mạng đứng NGAY sau mã nước, nên hai kiểu có
  // ngoặc / dấu cách trượt hoàn toàn và số thật đi thẳng tới model.
  const cases = [
    ['+8491 234 5678', 'mã nước liền, nhóm cách nhau'],
    ['+84900112233', 'liền một mạch'],
    ['(+84) 912345678', 'mã nước trong ngoặc'],
    ['+84 987654321', 'mã nước cách một khoảng'],
    ['0901234567', 'số nội địa liền'],
    ['0312345678', 'số nội địa, đầu 3'],
    ['0912 345 678', 'nội địa có khoảng trắng'],
    ['090.123.4567', 'nội địa dùng dấu chấm'],
  ] as const

  for (const [phone, label] of cases) {
    it(`bắt được: ${phone} (${label})`, () => {
      const r = redactPII(`Liên hệ: ${phone} nhé`)
      expect(r.text, `còn sót trong: ${r.text}`).not.toContain(phone)
      expect(r.text).toContain('<PHONE>')
      expect(r.map.PHONE).toBeTruthy()
    })
  }

  it('không nuốt nhầm năm hay chỉ số trong nội dung', () => {
    const r = redactPII('Tăng doanh thu 35% trong 2023, xử lý 5000 đơn/tháng')
    expect(r.text).not.toContain('<PHONE>')
  })
})

describe('tên người', () => {
  const names = [
    'Bình Lê',
    'DO VAN NAM',
    'VU HOANG NAM',
    'Khoa Vu',
    // HỒI QUY: âm tiết MỘT chữ cái. Bản đầu dùng `+` nên tên này trượt sạch.
    'Y THUY LINH TRAN',
    'Đỗ Á Châu',
  ]

  for (const name of names) {
    it(`bắt được "${name}" ở dòng đầu`, () => {
      const r = redactPII(`${name}\nBackend Developer\nabc@gmail.com`)
      expect(r.map.NAME).toBe(name)
      expect(r.text).not.toContain(name)
    })
  }

  it('tên ở dòng 2 vẫn bắt được — dòng 1 có thể là địa điểm', () => {
    // CV-02 thật có "hanoi Vietnam" ở dòng đầu, tên ở dòng hai
    const r = redactPII('hanoi Vietnam\nMichael Brown\nProduct Manager')
    expect(r.map.NAME).toBe('Michael Brown')
  })

  it('không nhầm tiêu đề mục thành tên', () => {
    const headings = [
      'SUMMARY',
      'EDUCATION',
      'WORK EXPERIENCE',
      'HỌC VẤN',
      'KINH NGHIỆM LÀM VIỆC'.replace(' LÀM VIỆC', ''),
      'Kỹ Năng',
      'THÔNG TIN CÁ NHÂN',
    ]
    for (const heading of headings) {
      const r = redactPII(`${heading}\nnội dung`)
      expect(r.map.NAME, heading).not.toBe(heading)
    }
  })

  it('vẫn bắt tên chứa âm tiết trùng từ khoá tiêu đề', () => {
    // "Công" là âm tiết tiêu đề ("quá trình công tác") nhưng cũng là tên người.
    // Chỉ loại khi CẢ DÒNG toàn âm tiết tiêu đề.
    for (const name of ['Lê Công Minh', 'Trần Ngôn Anh']) {
      const r = redactPII(`${name}\nDeveloper`)
      expect(r.map.NAME, name).toBe(name)
    }
  })

  it('chỉ quét 4 dòng đầu — tên công ty giữa CV không bị coi là tên người', () => {
    const r = redactPII('A\nB\nC\nD\nE\nCong Ty ABC')
    expect(r.map.NAME).not.toBe('Cong Ty ABC')
  })
})

describe('địa chỉ', () => {
  it('bắt địa chỉ thật', () => {
    for (const addr of ['Số 12 Nguyễn Trãi', 'Quận Ba Đình', 'Ngõ 5 Kim Mã', 'Q.7', 'P.12']) {
      const r = redactPII(`Địa chỉ: ${addr}, Hà Nội`)
      expect(r.text, addr).toContain('<LOCATION>')
    }
  })

  it('KHÔNG che nhầm mã trong URL — che thừa cũng hỏng như bỏ sót', () => {
    // HỒI QUY: "Q15" bên trong Q15ABCDEF0GH (mã theo dõi LinkedIn) từng khớp
    // rồi nuốt luôn 40 ký tự URL kế bên
    const url = 'https://www.linkedin.com/in/abc?trk=Q15ABCDEF0GH&x=1'
    const r = redactPII(`Hồ sơ: ${url}`)
    expect(r.text).toContain('Q15ABCDEF0GH')
    expect(r.map.LOCATION).toBeUndefined()
  })

  it('KHÔNG che nhầm tên công nghệ có chữ p/q kèm số', () => {
    // Viết tắt địa chỉ đòi dấu chấm ("Q.7"); "Q4"/"P3"/"H2" không có dấu chấm
    // nên được giữ nguyên — trong CV IT chúng là quý, mức ưu tiên, tên công nghệ
    const r = redactPII('Thành thạo H2 database, dùng P3 priority, doanh thu Q4')
    expect(r.text).not.toContain('<LOCATION>')
  })
})

describe('email và ngày sinh', () => {
  it('bắt email nhiều dạng', () => {
    for (const e of ['a.b@gmail.com', 'ten+tag@cong-ty.com.vn', 'Ten@ChuHoaLanLon.Com']) {
      const r = redactPII(`Email ${e}`)
      expect(r.text, e).not.toContain(e)
      expect(r.map.EMAIL).toContain(e)
    }
  })

  it('bắt ngày sinh', () => {
    const r = redactPII('Ngày sinh: 20/07/1999')
    expect(r.text).toContain('<DOB>')
    expect(r.map.DOB).toContain('20/07/1999')
  })
})

describe('redactSections — một bản đồ cho cả CV', () => {
  const CV = `NGUYEN VAN AN
Backend Developer
an.nguyen@gmail.com | 0912345678

HỌC VẤN
Đại học Bách Khoa — Kỹ sư CNTT

KINH NGHIỆM
Thực tập tại Công ty ABC. Liên hệ NGUYEN VAN AN qua 0912345678.`

  it('mục KHÔNG chứa dòng tên vẫn che được tên', () => {
    // Gọi redactPII riêng từng mục sẽ để lọt: mục "work" không có dòng đầu nên
    // không biết tên là gì
    const r = redactSections(CV, {
      education: 'Đại học Bách Khoa — Kỹ sư CNTT',
      work: 'Thực tập tại Công ty ABC. Liên hệ NGUYEN VAN AN qua 0912345678.',
    })

    expect(r.sections['work']).not.toContain('NGUYEN VAN AN')
    expect(r.sections['work']).not.toContain('0912345678')
    expect(r.sections['work']).toContain('<NAME>')
  })

  it('bản đồ chung giữ danh tính thống nhất cho mọi mục', () => {
    const r = redactSections(CV, { education: 'x', work: 'y' })
    expect(r.map.NAME).toBe('NGUYEN VAN AN')
    expect(r.map.EMAIL).toContain('an.nguyen@gmail.com')
    expect(r.map.PHONE?.[0]).toContain('0912345678')
  })

  it('không làm hỏng mục không chứa PII', () => {
    const r = redactSections(CV, { skills: 'Java, Spring Boot, PostgreSQL' })
    expect(r.sections['skills']).toBe('Java, Spring Boot, PostgreSQL')
  })
})

describe('identityFromMap', () => {
  it('dựng danh tính từ bản đồ', () => {
    const { map } = redactPII('NGUYEN VAN AN\nDev\nan@gmail.com | 0912345678')
    const id = identityFromMap(map)
    expect(id.name).toBe('NGUYEN VAN AN')
    expect(id.email).toBe('an@gmail.com')
    expect(id.phone).toContain('0912345678')
  })

  it('không tìm được tên thì có nhãn tạm, không để rỗng', () => {
    // `basics.name` là bắt buộc trong ProfileSchema — rỗng sẽ làm hỏng cả hồ sơ.
    // Màn hình rà soát (UC-22) là nơi user sửa lại.
    const id = identityFromMap({})
    expect(id.name).toBeTruthy()
  })
})
