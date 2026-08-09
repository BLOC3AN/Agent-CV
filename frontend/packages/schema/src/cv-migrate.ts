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
 *
 * v1 skills là mảng phẳng, v2 gom theo nhóm, nên `/skills/N` không có ánh xạ
 * trực tiếp — cần bảng tra cứu từ lúc gom: skillPointerByV1Index[N] = v2 pointer.
 */
function translateVerifiedPointer(
  pointer: string,
  skillPointerByV1Index: string[] = [],
): string | null {
  const introField: Record<string, string> = {
    name: 'fullName', headline: 'title', introduce: 'summary',
    email: 'email', phone: 'phone', location: 'location', photo: 'avatarUrl',
  }
  const section: Record<string, string> = {
    work: 'experience', projects: 'projects', education: 'education',
    activities: 'activities', certifications: 'certifications', languages: 'languages',
  }
  const parts = pointer.split('/').filter(Boolean)

  // v1 `/skills/N` hoặc `/skills/N/<field>` — dùng bảng tra cứu từ grouping
  if (parts[0] === 'skills' && /^\d+$/.test(parts[1]!)) {
    const v1SkillIndex = parseInt(parts[1]!, 10)
    if (v1SkillIndex < skillPointerByV1Index.length) {
      const basePointer = skillPointerByV1Index[v1SkillIndex]!
      if (parts.length === 2) return basePointer
      // `/skills/N/name` hoặc field khác → không dịch, những field này được cất vào
      // droppedFields, không có chỗ ở v2
      return null
    }
    return null
  }

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
  // Đồng thời xây dựng bảng v1→v2 index cho dịch verified pointers.
  const grouped: { category: string; skills: string[] }[] = []
  const skillPointerByV1Index: string[] = []
  for (let v1Index = 0; v1Index < profile.skills.length; v1Index++) {
    const s = profile.skills[v1Index]!
    const category = s.group ?? 'Khác'
    const bucket = grouped.find((g) => g.category === category)
    if (bucket) {
      const posInGroup = bucket.skills.length
      skillPointerByV1Index[v1Index] = `/sections/skills/${grouped.indexOf(bucket)}/skills/${posInGroup}`
      bucket.skills.push(s.name)
    } else {
      const groupIdx = grouped.length
      skillPointerByV1Index[v1Index] = `/sections/skills/${groupIdx}/skills/0`
      grouped.push({ category, skills: [s.name] })
    }
  }

  const verified: Record<string, boolean> = {}
  for (const [pointer, value] of Object.entries(profile._meta.verified)) {
    const translated = translateVerifiedPointer(pointer, skillPointerByV1Index)
    if (translated) verified[translated] = value
  }

  // Khoá là JSON Pointer của v1, nên cvToProfile() đặt lại đúng chỗ mà không
  // phải nhớ một bảng tên riêng.
  const droppedFields: Record<string, string> = {}
  if (b.dob) droppedFields['/basics/dob'] = b.dob
  profile.work.forEach((w, i) => {
    if (w.type) droppedFields[`/work/${i}/type`] = w.type
  })
  profile.projects.forEach((p, i) => {
    if (p.tech.length) droppedFields[`/projects/${i}/tech`] = JSON.stringify(p.tech)
  })
  profile.skills.forEach((s, i) => {
    if (s.level) droppedFields[`/skills/${i}/level`] = s.level
    // Giữ group nếu nó khác null/undefined: để round-trip phân biệt được
    // "không có group" từ "group là 'Khác'"
    if (s.group !== undefined && s.group !== null) {
      droppedFields[`/skills/${i}/group`] = s.group
    }
  })

  // Lưu thứ tự v1 qua v2 mapping để cvToProfile() khôi phục đúng vị trí.
  // Khi group lồng nhau (ví dụ: Py(A), Docker(B), Go(A)), gom lại sẽ cho [Py, Go],
  // [Docker], và flatten ngược lại là [Py, Go, Docker] — sai thứ tự. Mảng này
  // là chân lý để khôi phục [Py, Docker, Go] và canh chỉnh đúng /skills/i/* keys.
  if (profile.skills.length > 0) {
    droppedFields['/skills/_order'] = JSON.stringify(skillPointerByV1Index)
  }

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
        // Tech được lưu đầy đủ trong _meta.droppedFields, nên highlight này
        // chỉ để hiển thị cho con người.
        highlights: p.tech.length ? [`Công nghệ: ${p.tech.join(', ')}`, ...p.highlights] : p.highlights,
      })),
      education: profile.education.map((e, i) => ({
        id: itemId('edu', i),
        school: e.school,
        degree: e.degree ?? '',
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
