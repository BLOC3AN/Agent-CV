import type { Profile } from './profile.js'
import { CVSchema, type CV } from './cv.js'

/**
 * Ánh xạ v1 → v2 theo bảng spec 2026-08-09 §2.3.
 *
 * Mọi field v1 không có chỗ ở v2 đều được cất vào `_meta` chứ không vứt: cả
 * mảng `basics.links`, `basics.dob`, `work[].type`, `skills[].level`. Đó là
 * điều kiện để cvToProfile() khôi phục nguyên trạng; vứt đi là đường lùi không
 * còn là đường lùi, và không có đường lùi thì backfill không được phép chạy.
 */

/** Id ổn định theo vị trí: backfill chạy lại phải cho cùng kết quả (idempotent). */
const itemId = (section: string, index: number) => `${section}-${index}`

/**
 * Dịch khoá JSON Pointer của `_meta.verified`.
 *
 * Copy nguyên khoá là hỏng ngầm: `/basics/name` không tồn tại trong v2, nên
 * mọi dấu đã-xác-nhận của người dùng biến mất trong im lặng và UC-22 bắt họ rà
 * soát lại từ đầu.
 */
function translateVerifiedPointer(pointer: string): string | null {
  const introField: Record<string, string> = {
    name: 'fullName', headline: 'title', introduce: 'summary',
    email: 'email', phone: 'phone', location: 'location', photo: 'avatarUrl',
  }
  const section: Record<string, string> = {
    work: 'experience', projects: 'projects', education: 'education',
    activities: 'activities', certifications: 'certifications', languages: 'languages',
  }
  const parts = pointer.split('/').filter(Boolean)
  if (parts[0] === 'basics') {
    if (parts.length === 1) return '/sections/intro'
    const mapped = introField[parts[1]!]
    return mapped ? `/sections/intro/${mapped}` : null
  }
  const mappedSection = section[parts[0]!]
  if (!mappedSection) return null
  return ['/sections', mappedSection, ...parts.slice(1)].join('/')
}

export function profileToCV(
  profile: Profile,
  meta: { id: string; title: string; lastModified: string },
): CV {
  const b = profile.basics

  const canonical: Record<string, string> = {}
  for (const s of profile.skills) if (s.canonical) canonical[s.name] = s.canonical

  // Gom theo `group`, giữ nguyên thứ tự nhóm xuất hiện lần đầu — backfill chạy
  // lại phải ra cùng thứ tự, nếu không thì không idempotent.
  const grouped: { category: string; skills: string[] }[] = []
  for (const s of profile.skills) {
    const category = s.group ?? 'Khác'
    const bucket = grouped.find((g) => g.category === category)
    if (bucket) bucket.skills.push(s.name)
    else grouped.push({ category, skills: [s.name] })
  }

  const verified: Record<string, boolean> = {}
  for (const [pointer, value] of Object.entries(profile._meta.verified)) {
    const translated = translateVerifiedPointer(pointer)
    if (translated) verified[translated] = value
  }

  // Khoá là JSON Pointer của v1, nên cvToProfile() đặt lại đúng chỗ mà không
  // phải nhớ một bảng tên riêng.
  const droppedFields: Record<string, string> = {}
  if (b.dob) droppedFields['/basics/dob'] = b.dob
  profile.work.forEach((w, i) => {
    if (w.type) droppedFields[`/work/${i}/type`] = w.type
  })
  profile.skills.forEach((s, i) => {
    if (s.level) droppedFields[`/skills/${i}/level`] = s.level
  })

  return CVSchema.parse({
    schemaVersion: 2,
    id: meta.id,
    title: meta.title,
    lastModified: meta.lastModified,
    language: profile.language,
    sections: {
      intro: {
        fullName: b.name,
        title: b.headline ?? '',
        email: b.email ?? '',
        phone: b.phone ?? '',
        location: b.location ?? '',
        website: b.links[0]?.url,
        summary: b.introduce ?? '',
        avatarUrl: b.photo,
      },
      experience: profile.work.map((w, i) => ({
        id: itemId('exp', i),
        title: w.role,
        company: w.org,
        startDate: w.startDate ?? '',
        endDate: w.endDate ?? '',
        current: !w.endDate,
        highlights: w.highlights,
      })),
      projects: profile.projects.map((p, i) => ({
        id: itemId('proj', i),
        name: p.name,
        role: p.role ?? '',
        startDate: p.startDate ?? '',
        endDate: p.endDate ?? '',
        link: p.url,
        // `tech[]` không có chỗ riêng ở v2; gộp vào bullet đầu để không mất.
        highlights: p.tech.length ? [`Công nghệ: ${p.tech.join(', ')}`, ...p.highlights] : p.highlights,
      })),
      education: profile.education.map((e, i) => ({
        id: itemId('edu', i),
        school: e.school,
        degree: e.degree,
        fieldOfStudy: e.major ?? '',
        startDate: e.startDate ?? '',
        endDate: e.endDate ?? '',
        gpa: e.gpa,
        highlights: e.highlights,
      })),
      skills: grouped.map((g, i) => ({ id: itemId('skill', i), category: g.category, skills: g.skills })),
      activities: profile.activities.map((a, i) => ({
        id: itemId('act', i),
        organization: a.name,
        role: a.role ?? '',
        startDate: a.period ?? '',
        endDate: '',
        highlights: a.highlights,
      })),
      certifications: profile.certifications.map((c, i) => ({
        id: itemId('cert', i),
        name: c.name,
        issuer: c.issuer ?? '',
        date: c.date ?? '',
      })),
      languages: profile.languages.map((l, i) => ({
        id: itemId('lang', i),
        language: l.name,
        proficiency: l.level ?? '',
      })),
    },
    _meta: {
      verified,
      source: profile._meta.source,
      originalLinks: profile.basics.links,
      droppedFields,
      canonical,
    },
  })
}
