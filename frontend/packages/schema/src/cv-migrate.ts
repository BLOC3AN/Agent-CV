import { ProfileSchema, type Profile } from './profile.js'
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

  // v2 dùng '' làm mặc định cho field optional-string (title, startDate, ...).
  // Nếu v1 field vốn RỖNG TƯỜNG MINH (ví dụ endDate: "" cho công việc đang làm
  // ghi bằng chuỗi rỗng thay vì bỏ field), giá trị đó và "field không tồn tại"
  // đổ về cùng một '' ở v2 — khứ hồi không phân biệt được hai trạng thái nếu
  // không đánh dấu. Chỉ đánh dấu đúng khi giá trị LÀ chuỗi rỗng; field absent
  // (undefined) không cần đánh dấu vì hai chiều đã tự nhiên khớp nhau ('').
  const archiveEmpty = (pointer: string, value: string | undefined) => {
    if (value === '') droppedFields[pointer] = ''
  }
  // `email` không nằm trong danh sách: BasicsSchema validate bằng `.email()`,
  // chuỗi rỗng không phải email hợp lệ nên ProfileSchema.parse() đã chặn từ
  // trước — trạng thái "email rỗng tường minh" không bao giờ xảy ra với dữ
  // liệu hợp lệ, đánh dấu cho nó là code chết.
  archiveEmpty('/basics/headline', b.headline)
  archiveEmpty('/basics/introduce', b.introduce)
  archiveEmpty('/basics/phone', b.phone)
  archiveEmpty('/basics/location', b.location)
  profile.education.forEach((e, i) => {
    archiveEmpty(`/education/${i}/startDate`, e.startDate)
    archiveEmpty(`/education/${i}/endDate`, e.endDate)
  })
  profile.work.forEach((w, i) => {
    archiveEmpty(`/work/${i}/startDate`, w.startDate)
    archiveEmpty(`/work/${i}/endDate`, w.endDate)
  })
  profile.projects.forEach((p, i) => {
    archiveEmpty(`/projects/${i}/role`, p.role)
    archiveEmpty(`/projects/${i}/startDate`, p.startDate)
    archiveEmpty(`/projects/${i}/endDate`, p.endDate)
  })
  profile.activities.forEach((a, i) => {
    archiveEmpty(`/activities/${i}/role`, a.role)
    archiveEmpty(`/activities/${i}/period`, a.period)
  })
  profile.certifications.forEach((c, i) => {
    archiveEmpty(`/certifications/${i}/issuer`, c.issuer)
    archiveEmpty(`/certifications/${i}/date`, c.date)
  })
  profile.languages.forEach((l, i) => {
    archiveEmpty(`/languages/${i}/level`, l.level)
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

/**
 * Nghịch đảo của translateVerifiedPointer().
 *
 * Chỉ số phẳng của v1 KHÔNG tính lại được từ v2. Chiều đi gom nhóm, nên với
 * `[Python(A), Docker(B), Go(A)]` thì v2 là `[[Python,Go],[Docker]]`; trải
 * phẳng lại theo thứ tự nhóm ra `[Python, Go, Docker]` — sai thứ tự gốc, và
 * mọi khoá `/skills/N/level`, `/skills/N/group` gán chéo sang kỹ năng khác.
 * Thứ tự xen kẽ không còn tồn tại trong tài liệu v2, nên không công thức nào
 * dựng lại được. Chiều đi phải ghi bảng tra vào `_meta.droppedFields`
 * `['/skills/_order']`, và đây là chỗ đọc nó.
 *
 * `order[n]` = con trỏ v2 của kỹ năng ở chỉ số phẳng n của v1.
 */
function untranslateVerifiedPointer(
  pointer: string,
  order: string[],
): string | null {
  if (/^\/sections\/skills\/\d+\/skills\/\d+$/.test(pointer)) {
    const flat = order.indexOf(pointer)
    return flat === -1 ? null : `/skills/${flat}`
  }
  const introField: Record<string, string> = {
    fullName: 'name', title: 'headline', summary: 'introduce',
    email: 'email', phone: 'phone', location: 'location', avatarUrl: 'photo',
  }
  const section: Record<string, string> = {
    experience: 'work', projects: 'projects', education: 'education',
    activities: 'activities', certifications: 'certifications', languages: 'languages',
  }
  const parts = pointer.split('/').filter(Boolean)
  if (parts[0] !== 'sections') return null
  if (parts[1] === 'intro') {
    if (parts.length === 2) return '/basics'
    const mapped = introField[parts[2]!]
    return mapped ? `/basics/${mapped}` : null
  }
  const mapped = section[parts[1]!]
  return mapped ? ['', mapped, ...parts.slice(2)].join('/') : null
}

/**
 * v2 → v1. Đọc `_meta.originalLinks`, `_meta.droppedFields` và `_meta.canonical`
 * để dựng lại đúng những gì chiều đi đã cất đi.
 *
 * Test khứ hồi trong cv-migrate.test.ts là chốt chặn: v1 → v2 → v1 phải khớp
 * tuyệt đối. Chốt đó hỏng nghĩa là backfill không có đường lùi, và không có
 * đường lùi thì không được phép chạy trên dữ liệu thật.
 */
export function cvToProfile(cv: CV): Profile {
  const intro = cv.sections.intro
  const dropped = cv._meta.droppedFields

  // Lấy thẳng từ _meta chứ không dựng lại từ `website`: nhãn của link đầu tiên
  // không tồn tại ở v2, dựng lại là đoán.
  const links = cv._meta.originalLinks

  // Dựng lại mảng kỹ năng THEO BẢNG TRA, không trải phẳng theo thứ tự nhóm.
  // Trải phẳng là sai thứ tự ngay khi hồ sơ gốc xen kẽ nhóm, và mọi khoá
  // /skills/N/... gán chéo sang kỹ năng khác — xem ghi chú ở
  // untranslateVerifiedPointer().
  //
  // `category` của v2 chỉ là nhãn hiển thị. Nhóm thật đọc từ droppedFields: kỹ
  // năng không gắn nhóm và kỹ năng gắn nhóm tên đúng là "Khác" ra cùng một
  // category, nên suy ngược từ category là nhập hai trạng thái làm một.
  const order: string[] = dropped['/skills/_order']
    ? (JSON.parse(dropped['/skills/_order']) as string[])
    : []

  const skillNameAt = (pointer: string): string | null => {
    const m = pointer.match(/^\/sections\/skills\/(\d+)\/skills\/(\d+)$/)
    if (!m) return null
    return cv.sections.skills[Number(m[1])]?.skills[Number(m[2])] ?? null
  }

  const skills = order.flatMap((pointer, i) => {
    const name = skillNameAt(pointer)
    if (name === null) return []
    const level = dropped[`/skills/${i}/level`]
    const originalGroup = dropped[`/skills/${i}/group`]
    return [{
      name,
      ...(level ? { level } : {}),
      ...(cv._meta.canonical[name] ? { canonical: cv._meta.canonical[name] } : {}),
      ...(originalGroup ? { group: originalGroup } : {}),
    }]
  })

  const verified: Record<string, boolean> = {}
  for (const [pointer, value] of Object.entries(cv._meta.verified)) {
    const back = untranslateVerifiedPointer(pointer, order)
    if (back) verified[back] = value
  }

  // Nghịch đảo của archiveEmpty() ở profileToCV. v2 default('') làm "field vốn
  // rỗng" và "field không tồn tại" trông giống hệt nhau; droppedFields[pointer]
  // đã được set (kể cả bằng '') đúng khi v1 field là chuỗi rỗng tường minh, nên
  // tra bằng `in` chứ không tra bằng giá trị (giá trị đang lưu chính là '').
  const restoreEmpty = (
    pointer: string,
    v2Value: string,
    key: string,
  ): Record<string, string> => {
    if (v2Value) return { [key]: v2Value }
    if (pointer in dropped) return { [key]: '' }
    return {}
  }

  return ProfileSchema.parse({
    schemaVersion: 1,
    language: cv.language,
    basics: {
      name: intro.fullName,
      ...restoreEmpty('/basics/headline', intro.title, 'headline'),
      ...restoreEmpty('/basics/introduce', intro.summary, 'introduce'),
      // email luôn dùng kiểm tra thường: '' không phải email hợp lệ ở v1 nên
      // không bao giờ bị đánh dấu ở archiveEmpty(), xem ghi chú ở profileToCV.
      ...(intro.email ? { email: intro.email } : {}),
      ...restoreEmpty('/basics/phone', intro.phone, 'phone'),
      ...restoreEmpty('/basics/location', intro.location, 'location'),
      ...(dropped['/basics/dob'] ? { dob: dropped['/basics/dob'] } : {}),
      ...(intro.avatarUrl ? { photo: intro.avatarUrl } : {}),
      links,
    },
    education: cv.sections.education.map((e, i) => ({
      school: e.school,
      degree: e.degree,
      ...(e.fieldOfStudy ? { major: e.fieldOfStudy } : {}),
      ...restoreEmpty(`/education/${i}/startDate`, e.startDate, 'startDate'),
      ...restoreEmpty(`/education/${i}/endDate`, e.endDate, 'endDate'),
      ...(e.gpa ? { gpa: e.gpa } : {}),
      highlights: e.highlights,
    })),
    work: cv.sections.experience.map((x, i) => ({
      org: x.company,
      role: x.title,
      ...(dropped[`/work/${i}/type`] ? { type: dropped[`/work/${i}/type`] } : {}),
      ...restoreEmpty(`/work/${i}/startDate`, x.startDate, 'startDate'),
      ...restoreEmpty(`/work/${i}/endDate`, x.endDate, 'endDate'),
      highlights: x.highlights,
    })),
    // `tech` đọc từ droppedFields chứ không bóc từ chuỗi "Công nghệ: …".
    // Bóc chuỗi thì một bullet do người dùng tự viết mở đầu bằng đúng mấy chữ
    // đó cũng bị nuốt, và tech nào chứa ", " sẽ bị tách sai. Dòng hiển thị ở
    // highlights[0] chỉ là bản trình bày, dữ liệu thật nằm trong _meta.
    projects: cv.sections.projects.map((p, i) => {
      const rawTech = dropped[`/projects/${i}/tech`]
      const tech = rawTech ? (JSON.parse(rawTech) as string[]) : []
      return {
        name: p.name,
        ...restoreEmpty(`/projects/${i}/role`, p.role, 'role'),
        tech,
        ...(p.link ? { url: p.link } : {}),
        ...restoreEmpty(`/projects/${i}/startDate`, p.startDate, 'startDate'),
        ...restoreEmpty(`/projects/${i}/endDate`, p.endDate, 'endDate'),
        highlights: rawTech ? p.highlights.slice(1) : p.highlights,
      }
    }),
    skills,
    activities: cv.sections.activities.map((a, i) => ({
      name: a.organization,
      ...restoreEmpty(`/activities/${i}/role`, a.role, 'role'),
      ...restoreEmpty(`/activities/${i}/period`, a.startDate, 'period'),
      highlights: a.highlights,
    })),
    certifications: cv.sections.certifications.map((c, i) => ({
      name: c.name,
      ...restoreEmpty(`/certifications/${i}/issuer`, c.issuer, 'issuer'),
      ...restoreEmpty(`/certifications/${i}/date`, c.date, 'date'),
    })),
    languages: cv.sections.languages.map((l, i) => ({
      name: l.language,
      ...restoreEmpty(`/languages/${i}/level`, l.proficiency, 'level'),
    })),
    _meta: { verified, source: cv._meta.source },
  })
}
