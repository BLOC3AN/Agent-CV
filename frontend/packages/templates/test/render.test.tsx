import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProfileSchema, type Profile } from '@hr/schema'
import {
  TEMPLATES,
  TEMPLATE_IDS,
  getTemplate,
  atsTheme,
  atsLayout,
  DEFAULT_THEME,
  DEFAULT_LAYOUT,
  FieldProvider,
  groupSkills,
  ptr,
  type FieldRenderer,
} from '../src/index.js'

/**
 * TC-31-* · TC-32-* — mẫu CV và bản ATS-safe.
 * Không cần LLM, không cần mạng → chạy được cả khi model server chết (TC-32-06).
 */

const profile: Profile = ProfileSchema.parse({
  schemaVersion: 1,
  language: 'vi',
  basics: {
    name: 'Nguyễn Minh Khôi',
    headline: 'Lập trình viên Backend',
    email: 'khoi.nguyen@example.com',
    phone: '0901234567',
    location: 'Hà Nội',
    links: [{ label: 'GitHub', url: 'https://github.com/khoinm' }],
    introduce: 'Sinh viên năm cuối ngành Kỹ thuật phần mềm, tập trung Node.js.',
  },
  education: [
    {
      school: 'ĐH Bách Khoa Hà Nội',
      degree: 'Kỹ sư',
      major: 'Kỹ thuật phần mềm',
      startDate: '2021',
      endDate: '2025',
      gpa: '3.2',
      highlights: ['Đồ án tốt nghiệp đạt loại giỏi'],
    },
  ],
  work: [
    {
      org: 'Công ty ABC',
      role: 'Thực tập sinh Backend',
      startDate: '06/2024',
      endDate: '',
      highlights: ['Tối ưu truy vấn PostgreSQL, giảm thời gian từ 4.2s xuống 0.9s'],
    },
  ],
  projects: [
    {
      name: 'Website thương mại điện tử',
      tech: ['React', 'Node.js'],
      highlights: ['Xây dựng 28 API endpoint phục vụ 500+ sản phẩm'],
    },
  ],
  skills: [{ name: 'Node.js' }, { name: 'PostgreSQL' }, { name: 'Docker' }],
  activities: [],
  certifications: [{ name: 'AWS Cloud Practitioner', issuer: 'AWS', date: '2024' }],
  languages: [{ name: 'Tiếng Anh', level: 'IELTS 6.5' }],
})

const render = (id: string, props: Record<string, unknown> = {}) => {
  const T = getTemplate(id).component
  return renderToStaticMarkup(<T profile={profile} {...props} />)
}

describe('Registry — MVP có đúng 2 mẫu', () => {
  it('elegant và minimal', () => {
    expect(TEMPLATE_IDS.sort()).toEqual(['elegant', 'minimal'])
    expect(TEMPLATES.elegant.name.vi).toBe('Thanh lịch')
    expect(TEMPLATES.minimal.name.vi).toBe('Tối giản')
  })
  it('id lạ thì rơi về mẫu mặc định, không crash', () => {
    expect(getTemplate('khong-ton-tai').id).toBe('elegant')
  })
})

describe('DEFAULT_THEME.fontFamily — không được literal (Task 2, apps/web/lib/fonts.ts)', () => {
  it('render.tsx đặt --cv-font qua inline style; specificity của inline THẮNG rule trong styles.css, nên literal ở đây sẽ đè mất font đã nhúng', () => {
    const html = render('elegant')
    expect(html).toContain('--cv-font:var(--font-be-vietnam)')
    expect(html).not.toContain("--cv-font:'Be Vietnam Pro'")
  })
})

describe('TC-31-01 — đổi mẫu KHÔNG mất dữ liệu (BR-31.2)', () => {
  it('cả hai mẫu render đủ mọi nội dung của Profile', () => {
    for (const id of TEMPLATE_IDS) {
      const html = render(id)
      for (const needle of [
        'Nguyễn Minh Khôi',
        'ĐH Bách Khoa Hà Nội',
        'Thực tập sinh Backend',
        'Website thương mại điện tử',
        'PostgreSQL',
        'AWS Cloud Practitioner',
        'IELTS 6.5',
        '4.2s xuống 0.9s',
      ]) {
        expect(html, `${id} thiếu "${needle}"`).toContain(needle)
      }
    }
  })
})

describe('TC-31-03 — tắt mục thì không render nhưng dữ liệu vẫn còn', () => {
  it('hidden bỏ section khỏi HTML', () => {
    const html = render('elegant', { layout: { ...DEFAULT_LAYOUT, hidden: ['certifications'] } })
    expect(html).not.toContain('AWS Cloud Practitioner')
    expect(html).toContain('ĐH Bách Khoa Hà Nội') // các mục khác giữ nguyên
    expect(profile.certifications).toHaveLength(1) // dữ liệu KHÔNG bị xoá
  })

  it('order đổi thứ tự render', () => {
    const html = render('elegant', {
      layout: { ...DEFAULT_LAYOUT, order: ['skills', 'work', 'education'] },
    })
    expect(html.indexOf('Kỹ năng')).toBeLessThan(html.indexOf('Kinh nghiệm'))
  })
})

describe('TC-32-02 — bản ATS-safe (BR-32.1)', () => {
  const ats = render('elegant', { variant: 'ats' })

  it('luôn 1 cột dù layout yêu cầu 2', () => {
    const forced = render('elegant', {
      variant: 'ats',
      layout: { ...DEFAULT_LAYOUT, columns: 2, sidebar: ['skills'] },
    })
    expect(forced).not.toContain('cv-two-col')
  })

  it('bỏ màu và trang trí', () => {
    const t = atsTheme(DEFAULT_THEME)
    expect(t.accent).toBe('#000000')
    expect(t.showIcons).toBe(false)
    expect(t.showDividers).toBe(false)
    expect(atsLayout({ ...DEFAULT_LAYOUT, columns: 2 }).columns).toBe(1)
  })

  it('đánh dấu data-variant để CSS ATS có hiệu lực', () => {
    expect(ats).toContain('data-variant="ats"')
  })

  it('vẫn giữ ĐỦ nội dung — ATS-safe không phải cắt bớt', () => {
    for (const needle of ['Nguyễn Minh Khôi', 'PostgreSQL', 'ĐH Bách Khoa Hà Nội']) {
      expect(ats).toContain(needle)
    }
  })

  it('bản trình bày thì KHÔNG bị ép về ATS', () => {
    const pres = render('elegant', { variant: 'presentation' })
    expect(pres).toContain('data-variant="presentation"')
  })
})

describe('TC-32-04 — tiếng Việt có dấu', () => {
  it('không mất dấu, không thành ký tự thay thế', () => {
    const html = render('elegant')
    expect(html).toContain('Nguyễn Minh Khôi')
    expect(html).toContain('Kỹ thuật phần mềm')
    expect(html).not.toMatch(/Nguy\?n|Ph\?n m\?m|�/)
  })

  it('tiêu đề mục theo ngôn ngữ của Profile', () => {
    const vi = render('elegant')
    expect(vi).toContain('Kinh nghiệm')
    expect(vi).toContain('Học vấn')

    const enProfile = { ...profile, language: 'en' as const }
    const T = getTemplate('elegant').component
    const en = renderToStaticMarkup(<T profile={enProfile} />)
    expect(en).toContain('Experience')
    expect(en).toContain('Education')
  })
})

describe('Ngắt trang — TC-32-07', () => {
  it('mỗi entry có class chống cắt ngang', () => {
    const html = render('elegant')
    expect(html).toContain('cv-entry')
    expect(html).toContain('cv-section-title')
  })
})

describe('Field — cầu nối tới editor (FRONTEND.md §9.4)', () => {
  it('mặc định render tĩnh, không dính code editor', () => {
    const html = render('elegant')
    expect(html).not.toContain('contenteditable')
    expect(html).not.toContain('data-editable')
  })

  it('FieldProvider thay được renderer, path đúng JSON Pointer', () => {
    const seen: string[] = []
    const spy: FieldRenderer = ({ path, children }) => {
      seen.push(path)
      return <span data-editable={path}>{children}</span>
    }
    const T = getTemplate('elegant').component
    const html = renderToStaticMarkup(
      <FieldProvider renderer={spy}>
        <T profile={profile} />
      </FieldProvider>,
    )
    expect(html).toContain('data-editable="/basics/name"')
    expect(seen).toContain('/work/0/highlights/0')
    expect(seen).toContain('/education/0/school')
    // Mọi path phải bắt đầu bằng "/" và không có ký tự lạ
    for (const p of seen) expect(p).toMatch(/^\/[\w/~-]*$/)
  })

  it('ptr escape đúng RFC 6901', () => {
    expect(ptr('a', 0, 'b')).toBe('/a/0/b')
    expect(ptr('a/b')).toBe('/a~1b')
    expect(ptr('a~b')).toBe('/a~0b')
  })
})

describe('Profile rỗng — không crash', () => {
  it('chỉ có tên vẫn render được (BR-23.1)', () => {
    const bare = ProfileSchema.parse({
      schemaVersion: 1,
      language: 'vi',
      basics: { name: 'A' },
    })
    const T = getTemplate('elegant').component
    const html = renderToStaticMarkup(<T profile={bare} />)
    expect(html).toContain('A')
    expect(html).not.toContain('Kinh nghiệm') // section rỗng bị bỏ
  })
})

// ── UC-57 · nhóm kỹ năng ───────────────────────────────────────────────────
//
// Sinh ra từ một ngõ cụt có thật: trợ lý tự đề xuất "nhóm các công cụ thành
// nhóm (ML Ops, Edge AI, Cloud)", người dùng bấm đúng gợi ý đó, và nhận
// "giá trị không đúng dạng ở skills/0" — vì `SkillSchema` không có chỗ để đặt
// nhóm. Hệ thống mời người dùng làm một việc nó không làm được.

const grouped: Profile = ProfileSchema.parse({
  schemaVersion: 1,
  language: 'vi',
  basics: { name: 'Trần Hoàng Nam' },
  skills: [
    { name: 'YOLOv8', group: 'Edge AI' },
    { name: 'Docker', group: 'MLOps' },
    { name: 'ByteTrack', group: 'Edge AI' },
    { name: 'Kafka' },
  ],
})

function markup(p: Profile, variant: 'presentation' | 'ats' = 'presentation'): string {
  const T = getTemplate('elegant').component
  return renderToStaticMarkup(
    <T
      profile={p}
      theme={variant === 'ats' ? atsTheme(DEFAULT_THEME) : DEFAULT_THEME}
      layout={variant === 'ats' ? atsLayout(DEFAULT_LAYOUT) : DEFAULT_LAYOUT}
      variant={variant}
    />,
  )
}

describe('TC-57 — nhóm kỹ năng', () => {
  it('TC-57-02 gom theo nhóm, giữ thứ tự nhóm xuất hiện lần đầu', () => {
    const g = groupSkills(grouped.skills)
    expect(g.map((x) => x.name)).toEqual(['Edge AI', 'MLOps', null])
    expect(g[0]!.items.map((i) => i.skill.name)).toEqual(['YOLOv8', 'ByteTrack'])
  })

  it('TC-57-03 kỹ năng CHƯA có nhóm vẫn hiện ra (BR-57.2)', () => {
    // Gom nhóm mà làm mất kỹ năng thì hỏng nặng hơn là không gom
    const html = markup(grouped)
    for (const s of ['YOLOv8', 'Docker', 'ByteTrack', 'Kafka']) {
      expect(html).toContain(s)
    }
  })

  it('`index` trỏ đúng vị trí trong hồ sơ, không phải vị trí trong nhóm', () => {
    const g = groupSkills(grouped.skills)
    expect(g[0]!.items.map((i) => i.index)).toEqual([0, 2])
    expect(g[2]!.items.map((i) => i.index)).toEqual([3])
  })

  it('TC-57-04 không kỹ năng nào có nhóm → hiện phẳng như cũ', () => {
    const flat = ProfileSchema.parse({
      schemaVersion: 1,
      language: 'vi',
      basics: { name: 'A' },
      skills: [{ name: 'Node.js' }, { name: 'React' }],
    })
    const html = markup(flat)
    expect(html).not.toContain('cv-skill-group')
    expect(html).toContain('Node.js')
  })

  it('tên nhóm hiện ra ở bản trình bày', () => {
    const html = markup(grouped)
    expect(html).toContain('Edge AI')
    expect(html).toContain('cv-skill-group-name')
  })

  it('TC-57-05 bản ATS vẫn liệt kê đủ kỹ năng', () => {
    // Nhãn nhóm bị CSS ẩn ở bản ATS (BR-57.3), nhưng kỹ năng thì không được mất
    const html = markup(grouped, 'ats')
    for (const s of ['YOLOv8', 'Docker', 'ByteTrack', 'Kafka']) {
      expect(html).toContain(s)
    }
  })
})
