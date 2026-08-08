import type { Profile } from '@hr/schema'
import type { ReactNode } from 'react'
import { Field } from './field.js'
import { ptr } from './pointer.js'
import type { SectionId, TemplateVariant } from './types.js'

/**
 * Các khối section dùng chung cho mọi template.
 * Template chỉ quyết định sắp xếp và style; nội dung và `path` thống nhất ở đây
 * để mọi template đều sửa inline được như nhau (FRONTEND.md §9.4).
 */

const L = {
  vi: {
    summary: 'Giới thiệu',
    work: 'Kinh nghiệm',
    projects: 'Dự án',
    education: 'Học vấn',
    skills: 'Kỹ năng',
    activities: 'Hoạt động',
    certifications: 'Chứng chỉ',
    languages: 'Ngoại ngữ',
    present: 'Hiện tại',
  },
  en: {
    summary: 'Summary',
    work: 'Experience',
    projects: 'Projects',
    education: 'Education',
    skills: 'Skills',
    activities: 'Activities',
    certifications: 'Certifications',
    languages: 'Languages',
    present: 'Present',
  },
} as const

export function sectionTitle(id: SectionId, lang: 'vi' | 'en'): string {
  return L[lang][id]
}

function dateRange(
  start: string | undefined,
  end: string | undefined,
  lang: 'vi' | 'en',
): string {
  if (!start && !end) return ''
  const e = end && end.trim() !== '' ? end : L[lang].present
  return start ? `${start} – ${e}` : e
}

function Section({
  id,
  title,
  children,
}: {
  id: SectionId
  title: string
  children: ReactNode
}) {
  return (
    <section className="cv-section" data-section={id}>
      <h2 className="cv-section-title">{title}</h2>
      {children}
    </section>
  )
}

function Bullets({ items, basePath }: { items: string[]; basePath: string }) {
  if (items.length === 0) return null
  return (
    <ul className="cv-bullets">
      {items.map((h, i) => (
        <Field key={i} path={`${basePath}/${i}`} as="li" multiline>
          {h}
        </Field>
      ))}
    </ul>
  )
}

export interface SectionProps {
  profile: Profile
  variant: TemplateVariant
}

/**
 * Kỹ năng gom theo `group`, giữ THỨ TỰ NHÓM XUẤT HIỆN LẦN ĐẦU — UC-57.
 *
 * Không sắp xếp lại theo bảng chữ cái: thứ tự người dùng viết ra mang thông tin
 * (nhóm mạnh nhất thường đứng đầu), sắp lại là vứt thông tin đó đi.
 *
 * Kỹ năng chưa có nhóm dồn xuống một nhóm cuối KHÔNG TÊN thay vì bị bỏ qua
 * (BR-57.2) — giữ luôn `index` để `Field` trỏ đúng chỗ trong hồ sơ.
 */
export function groupSkills(
  skills: Profile['skills'],
): { name: string | null; items: { skill: Profile['skills'][number]; index: number }[] }[] {
  const byName = new Map<string | null, { skill: Profile['skills'][number]; index: number }[]>()
  for (const [index, skill] of skills.entries()) {
    const key = skill.group?.trim() || null
    const bucket = byName.get(key)
    if (bucket) bucket.push({ skill, index })
    else byName.set(key, [{ skill, index }])
  }

  const named = [...byName.entries()].filter(([k]) => k !== null)
  const rest = byName.get(null)
  return [
    ...named.map(([name, items]) => ({ name, items })),
    ...(rest ? [{ name: null, items: rest }] : []),
  ]
}

export function renderSection(id: SectionId, p: SectionProps): ReactNode | null {
  const { profile } = p
  const lang = profile.language
  const t = (k: SectionId) => sectionTitle(k, lang)

  switch (id) {
    case 'summary': {
      const s = profile.basics.summary
      if (!s) return null
      return (
        <Section key={id} id={id} title={t('summary')}>
          <Field path={ptr('basics', 'summary')} as="p" multiline>
            {s}
          </Field>
        </Section>
      )
    }

    case 'work': {
      if (profile.work.length === 0) return null
      return (
        <Section key={id} id={id} title={t('work')}>
          {profile.work.map((w, i) => (
            <div className="cv-entry" key={i}>
              <div className="cv-entry-head">
                <div>
                  <Field path={ptr('work', i, 'role')} className="cv-entry-title">
                    {w.role}
                  </Field>
                  {w.org && (
                    <>
                      <span className="cv-entry-org"> — </span>
                      <Field path={ptr('work', i, 'org')} className="cv-entry-org">
                        {w.org}
                      </Field>
                    </>
                  )}
                </div>
                <span className="cv-entry-date">
                  {dateRange(w.startDate, w.endDate, lang)}
                </span>
              </div>
              <Bullets items={w.highlights} basePath={ptr('work', i, 'highlights')} />
            </div>
          ))}
        </Section>
      )
    }

    case 'projects': {
      if (profile.projects.length === 0) return null
      return (
        <Section key={id} id={id} title={t('projects')}>
          {profile.projects.map((x, i) => (
            <div className="cv-entry" key={i}>
              <div className="cv-entry-head">
                <div>
                  <Field path={ptr('projects', i, 'name')} className="cv-entry-title">
                    {x.name}
                  </Field>
                  {x.tech.length > 0 && (
                    <span className="cv-entry-org"> — {x.tech.join(', ')}</span>
                  )}
                </div>
                <span className="cv-entry-date">
                  {dateRange(x.startDate, x.endDate, lang)}
                </span>
              </div>
              <Bullets items={x.highlights} basePath={ptr('projects', i, 'highlights')} />
            </div>
          ))}
        </Section>
      )
    }

    case 'education': {
      if (profile.education.length === 0) return null
      return (
        <Section key={id} id={id} title={t('education')}>
          {profile.education.map((e, i) => (
            <div className="cv-entry" key={i}>
              <div className="cv-entry-head">
                <div>
                  <Field path={ptr('education', i, 'school')} className="cv-entry-title">
                    {e.school}
                  </Field>
                  <span className="cv-entry-org">
                    {' — '}
                    <Field path={ptr('education', i, 'degree')}>{e.degree}</Field>
                    {e.major ? `, ${e.major}` : ''}
                    {e.gpa ? ` · GPA ${e.gpa}` : ''}
                  </span>
                </div>
                <span className="cv-entry-date">
                  {dateRange(e.startDate, e.endDate, lang)}
                </span>
              </div>
              <Bullets items={e.highlights} basePath={ptr('education', i, 'highlights')} />
            </div>
          ))}
        </Section>
      )
    }

    case 'skills': {
      if (profile.skills.length === 0) return null

      // Gom nhóm khi CÓ nhóm, còn không thì hiện phẳng như cũ — UC-57.
      //
      // Kỹ năng chưa được đặt nhóm vẫn phải hiện ra (BR-57.2): gom nhóm mà làm
      // mất kỹ năng thì hỏng nặng hơn là không gom.
      const groups = groupSkills(profile.skills)
      if (groups.length === 1 && groups[0]!.name === null) {
        return (
          <Section key={id} id={id} title={t('skills')}>
            <div className="cv-skills">
              {profile.skills.map((s, i) => (
                <Field key={i} path={ptr('skills', i, 'name')} className="cv-skill">
                  {s.name}
                </Field>
              ))}
            </div>
          </Section>
        )
      }

      return (
        <Section key={id} id={id} title={t('skills')}>
          {groups.map((g) => (
            <div className="cv-skill-group" key={g.name ?? '__khac'}>
              {g.name !== null && <span className="cv-skill-group-name">{g.name}</span>}
              <div className="cv-skills">
                {g.items.map(({ skill, index }) => (
                  <Field key={index} path={ptr('skills', index, 'name')} className="cv-skill">
                    {skill.name}
                  </Field>
                ))}
              </div>
            </div>
          ))}
        </Section>
      )
    }

    case 'activities': {
      if (profile.activities.length === 0) return null
      return (
        <Section key={id} id={id} title={t('activities')}>
          {profile.activities.map((a, i) => (
            <div className="cv-entry" key={i}>
              <div className="cv-entry-head">
                <div>
                  <Field path={ptr('activities', i, 'name')} className="cv-entry-title">
                    {a.name}
                  </Field>
                  {a.role && <span className="cv-entry-org"> — {a.role}</span>}
                </div>
                <span className="cv-entry-date">{a.period ?? ''}</span>
              </div>
              <Bullets items={a.highlights} basePath={ptr('activities', i, 'highlights')} />
            </div>
          ))}
        </Section>
      )
    }

    case 'certifications': {
      if (profile.certifications.length === 0) return null
      return (
        <Section key={id} id={id} title={t('certifications')}>
          <ul className="cv-bullets">
            {profile.certifications.map((c, i) => (
              <li key={i}>
                <Field path={ptr('certifications', i, 'name')}>{c.name}</Field>
                {c.issuer ? ` — ${c.issuer}` : ''}
                {c.date ? ` (${c.date})` : ''}
              </li>
            ))}
          </ul>
        </Section>
      )
    }

    case 'languages': {
      if (profile.languages.length === 0) return null
      return (
        <Section key={id} id={id} title={t('languages')}>
          <ul className="cv-bullets">
            {profile.languages.map((l, i) => (
              <li key={i}>
                <Field path={ptr('languages', i, 'name')}>{l.name}</Field>
                {l.level ? ` — ${l.level}` : ''}
              </li>
            ))}
          </ul>
        </Section>
      )
    }

    default:
      return null
  }
}

export function Header({ profile }: { profile: Profile }) {
  const b = profile.basics
  const bits: ReactNode[] = []
  if (b.email) bits.push(<Field key="e" path={ptr('basics', 'email')}>{b.email}</Field>)
  if (b.phone) bits.push(<Field key="p" path={ptr('basics', 'phone')}>{b.phone}</Field>)
  if (b.location)
    bits.push(<Field key="l" path={ptr('basics', 'location')}>{b.location}</Field>)
  for (const [i, link] of b.links.entries()) {
    bits.push(
      <a key={`k${i}`} href={link.url}>
        {link.label}
      </a>,
    )
  }

  return (
    <header className="cv-header">
      <Field path={ptr('basics', 'name')} as="h1" className="cv-name">
        {b.name}
      </Field>
      {b.headline && (
        <Field path={ptr('basics', 'headline')} as="p" className="cv-headline">
          {b.headline}
        </Field>
      )}
      {bits.length > 0 && <div className="cv-contact">{bits}</div>}
    </header>
  )
}
