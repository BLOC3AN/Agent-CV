import { z } from 'zod'
import { CVLayoutSchema, DEFAULT_CV_LAYOUT } from './cv-layout.js'

/**
 * CV v2 — spec 2026-08-09 §2.1.
 *
 * Đây là schema duy nhất của dữ liệu CV production.
 */

export const CVLanguageSchema = z.enum(['vi', 'en'])

/**
 * PII v2 — năm đường dẫn này KHÔNG BAO GIỜ được gửi tới model.
 *
 * `redact_pii.required_local: true` trong config.yml bám vào đúng danh sách
 * này. Thiếu một dòng thì PII đi thẳng tới provider cloud và không có lỗi nào
 * được ném ra — hỏng im lặng, loại tệ nhất. Bản Go tương ứng nằm ở
 * backend/internal/pii/pii.go và phải khớp từng dòng.
 *
 * `website` và `summary` KHÔNG phải PII: chúng là nội dung nghề nghiệp, model
 * cần đọc để đề xuất có nghĩa.
 */
export const PII_PATHS_V2 = [
  '/sections/intro/fullName',
  '/sections/intro/email',
  '/sections/intro/phone',
  '/sections/intro/location',
  '/sections/intro/avatarUrl',
] as const

export const IntroSectionSchema = z.object({
  fullName: z.string(),
  title: z.string().default(''),
  email: z.string().default(''),
  phone: z.string().default(''),
  location: z.string().default(''),
  website: z.string().optional(),
  summary: z.string().default(''),
  careerObjective: z.string().optional(),
  availability: z.string().optional(),
  avatarUrl: z.string().optional(),
}).strict()

/**
 * `.strict()` ở mọi mục có bullet, và bullet là `highlights: string[]`.
 *
 * Spec §2.2(3): chat sinh JSON Patch nhắm vào một gạch đầu dòng cụ thể
 * (`/sections/experience/0/highlights/2`). Nếu đây là một chuỗi `description`,
 * mọi đề xuất của AI biến thành ghi đè nguyên khối và màn duyệt diff không còn
 * gì đáng duyệt. `.strict()` để `description` bị từ chối thẳng thay vì lặng lẽ
 * bị bỏ qua rồi mất dữ liệu.
 */
export const ExperienceItemSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    company: z.string(),
    startDate: z.string().default(''),
    endDate: z.string().default(''),
    current: z.boolean().default(false),
    teamSize: z.string().optional(),
    techStack: z.array(z.string()).optional(),
    highlights: z.array(z.string()).default([]),
  })
  .strict()

export const ProjectItemSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    role: z.string().default(''),
    startDate: z.string().default(''),
    endDate: z.string().default(''),
    link: z.string().optional(),
    teamSize: z.string().optional(),
    techStack: z.array(z.string()).optional(),
    contribution: z.string().optional(),
    highlights: z.array(z.string()).default([]),
  })
  .strict()

export const EducationItemSchema = z
  .object({
    id: z.string(),
    school: z.string(),
    degree: z.string().default(''),
    fieldOfStudy: z.string().default(''),
    startDate: z.string().default(''),
    endDate: z.string().default(''),
    gpa: z.string().optional(),
    highlights: z.array(z.string()).default([]),
  })
  .strict()

/** `skills` v2 gom theo nhóm: một dòng là một mảng kỹ năng cùng category (UC-57). */
export const SkillItemSchema = z
  .object({
    id: z.string(),
    category: z.string(),
    skills: z.array(z.string()).default([]),
  })
  .strict()

export const ActivityItemSchema = z
  .object({
    id: z.string(),
    organization: z.string(),
    role: z.string().default(''),
    startDate: z.string().default(''),
    endDate: z.string().default(''),
    highlights: z.array(z.string()).default([]),
  })
  .strict()

export const CertificationItemSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    issuer: z.string().default(''),
    date: z.string().default(''),
    link: z.string().optional(),
  })
  .strict()

export const LanguageItemSchema = z
  .object({
    id: z.string(),
    language: z.string(),
    proficiency: z.string().default(''),
  })
  .strict()

function uniqueIDs<T extends z.ZodTypeAny>(schema: T) {
  return z.array(schema).default([]).superRefine((items, context) => {
    const seen = new Set<string>()
    items.forEach((item, index) => {
      const id = (item as { id?: unknown }).id
      if (typeof id === 'string' && seen.has(id)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: [index, 'id'], message: `Duplicate item id: ${id}` })
      }
      if (typeof id === 'string') seen.add(id)
    })
  })
}

export const CVSectionsSchema = z.object({
  intro: IntroSectionSchema,
  experience: uniqueIDs(ExperienceItemSchema),
  projects: uniqueIDs(ProjectItemSchema),
  education: uniqueIDs(EducationItemSchema),
  skills: uniqueIDs(SkillItemSchema),
  activities: uniqueIDs(ActivityItemSchema),
  certifications: uniqueIDs(CertificationItemSchema),
  languages: uniqueIDs(LanguageItemSchema),
}).strict()

export const CVDesignSchema = z.object({
  template: z.enum(['modern', 'classic', 'professional']).default('modern'),
  accentColor: z.string().default('#4F46E5'),
  font: z.enum(['Roboto', 'Open Sans', 'Lato']).default('Roboto'),
  fontSize: z.number().default(14),
  spacing: z.enum(['condensed', 'normal', 'wide']).default('normal'),
}).strict()

export const ActiveSectionsSchema = z.object({
  intro: z.boolean().default(true),
  experience: z.boolean().default(true),
  projects: z.boolean().default(true),
  education: z.boolean().default(true),
  skills: z.boolean().default(true),
  activities: z.boolean().default(true),
  certifications: z.boolean().default(true),
  languages: z.boolean().default(true),
}).strict()

/**
 * `verified` — xương sống chống bịa: mọi nội dung
 * do AI sinh ra là false cho tới khi người dùng xác nhận (UC-22, UC-53).
 *
 * `canonical` giữ tên kỹ năng chuẩn hoá để matching ổn định (BR-57.1).
 */
export const CVMetaSchema = z.object({
  verified: z.record(z.boolean()).default({}),
  source: z.enum(['manual', 'pdf_import', 'ai_generated']).default('manual'),
  canonical: z.record(z.string()).default({}),
}).strict()

export const CVSchema = z.object({
  schemaVersion: z.literal(2),
  id: z.string(),
  title: z.string(),
  lastModified: z.string(),
  language: CVLanguageSchema,
  sections: CVSectionsSchema,
  design: CVDesignSchema.default({}),
  activeSections: ActiveSectionsSchema.default({}),
  layout: CVLayoutSchema.default(DEFAULT_CV_LAYOUT),
  _meta: CVMetaSchema.default({}),
}).strict()

export type CV = z.infer<typeof CVSchema>
export type CVSections = z.infer<typeof CVSectionsSchema>
export type IntroSection = z.infer<typeof IntroSectionSchema>
export type ExperienceItem = z.infer<typeof ExperienceItemSchema>
export type SkillItem = z.infer<typeof SkillItemSchema>
