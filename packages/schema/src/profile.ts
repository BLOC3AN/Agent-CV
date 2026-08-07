import { z } from 'zod'

/**
 * ProfileSchema — nguồn sự thật duy nhất về dữ liệu ứng viên.
 * TDD §7.3. Tách hoàn toàn khỏi presentation (CVDocument).
 */

export const LanguageSchema = z.enum(['vi', 'en'])
export type Language = z.infer<typeof LanguageSchema>

export const LinkSchema = z.object({
  label: z.string(),
  url: z.string().url(),
})

/**
 * PII — các field này KHÔNG BAO GIỜ được gửi tới model.
 * Xem stripPII() trong packages/ai/src/pii.ts và TDD §15.2 R1.
 */
export const PII_PATHS = [
  '/basics/name',
  '/basics/email',
  '/basics/phone',
  '/basics/location',
  '/basics/dob',
  '/basics/photo',
] as const

export const BasicsSchema = z.object({
  name: z.string().min(1, 'Tên là bắt buộc'),
  headline: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  location: z.string().optional(),
  dob: z.string().optional(),
  photo: z.string().optional(),
  links: z.array(LinkSchema).default([]),
  summary: z.string().optional(),
})

export const EducationSchema = z.object({
  school: z.string(),
  degree: z.string(),
  major: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  gpa: z.string().optional(),
  highlights: z.array(z.string()).default([]),
})

export const WorkSchema = z.object({
  org: z.string(),
  role: z.string(),
  type: z.enum(['fulltime', 'parttime', 'intern', 'freelance']).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  highlights: z.array(z.string()).default([]),
})

export const ProjectSchema = z.object({
  name: z.string(),
  role: z.string().optional(),
  tech: z.array(z.string()).default([]),
  url: z.string().url().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  highlights: z.array(z.string()).default([]),
})

export const SkillSchema = z.object({
  name: z.string(),
  level: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  /** Sau khi chuẩn hoá qua skill_taxonomy — dùng cho matching lớp keyword */
  canonical: z.string().optional(),
  /**
   * Nhóm hiển thị: "Edge AI", "MLOps", "Cloud" — UC-57.
   *
   * CV sinh viên hay liệt kê 20+ công cụ thành một dãy dài mà nhà tuyển dụng
   * quét 6 giây không rút ra được gì. Gom nhóm thì cùng nội dung đó đọc được
   * ngay.
   *
   * CHỈ là nhãn hiển thị (BR-57.1): lớp đối chiếu JD vẫn dùng `canonical`, nên
   * gom nhóm không làm đổi điểm.
   */
  group: z.string().optional(),
})

export const ActivitySchema = z.object({
  name: z.string(),
  role: z.string().optional(),
  period: z.string().optional(),
  highlights: z.array(z.string()).default([]),
})

export const CertificationSchema = z.object({
  name: z.string(),
  issuer: z.string().optional(),
  date: z.string().optional(),
})

export const LanguageSkillSchema = z.object({
  name: z.string(),
  level: z.string().optional(),
})

/**
 * _meta.verified — xương sống chống hallucination.
 * Mọi nội dung do AI sinh ra là false cho tới khi user xác nhận (UC-22, UC-53).
 * Key là JSON Pointer tới field.
 */
export const ProfileMetaSchema = z.object({
  verified: z.record(z.boolean()).default({}),
  source: z.enum(['manual', 'pdf_import', 'ai_generated']).default('manual'),
})

export const ProfileSchema = z.object({
  schemaVersion: z.literal(1),
  language: LanguageSchema,
  basics: BasicsSchema,
  education: z.array(EducationSchema).default([]),
  work: z.array(WorkSchema).default([]),
  projects: z.array(ProjectSchema).default([]),
  skills: z.array(SkillSchema).default([]),
  activities: z.array(ActivitySchema).default([]),
  certifications: z.array(CertificationSchema).default([]),
  languages: z.array(LanguageSkillSchema).default([]),
  _meta: ProfileMetaSchema.default({ verified: {}, source: 'manual' }),
})

export type Profile = z.infer<typeof ProfileSchema>
export type Basics = z.infer<typeof BasicsSchema>
export type Education = z.infer<typeof EducationSchema>
export type Work = z.infer<typeof WorkSchema>
export type Project = z.infer<typeof ProjectSchema>
export type Skill = z.infer<typeof SkillSchema>

/**
 * ParsedProfile — thứ MODEL được phép trả về khi đọc CV.
 *
 * TDD §15.2 R1: PII bị che bằng code TRƯỚC khi gửi model, nên model không nhìn
 * thấy và cũng không được yêu cầu trả lại. `basics` ở đây chỉ còn phần phi-PII.
 * Danh tính thật được gắn lại ở tầng ứng dụng sau khi model trả kết quả.
 *
 * Lợi ích phụ: schema gửi cho constrained decoding nhỏ hơn, và model không có
 * cơ hội bịa ra email/SĐT không tồn tại.
 */
export const ParsedBasicsSchema = z.object({
  headline: z.string().optional(),
  links: z.array(LinkSchema).default([]),
  summary: z.string().optional(),
})

export const ParsedProfileSchema = z.object({
  schemaVersion: z.literal(1),
  language: LanguageSchema,
  basics: ParsedBasicsSchema,
  education: z.array(EducationSchema).default([]),
  work: z.array(WorkSchema).default([]),
  projects: z.array(ProjectSchema).default([]),
  skills: z.array(SkillSchema).default([]),
  activities: z.array(ActivitySchema).default([]),
  certifications: z.array(CertificationSchema).default([]),
  languages: z.array(LanguageSkillSchema).default([]),
})

export type ParsedProfile = z.infer<typeof ParsedProfileSchema>

/** Ghép ParsedProfile (từ model) với danh tính (từ bảng PII đã tách) → Profile */
export function assembleProfile(
  parsed: ParsedProfile,
  identity: { name: string } & Partial<Omit<Basics, 'name' | 'links' | 'summary' | 'headline'>>,
  source: Profile['_meta']['source'] = 'pdf_import',
): Profile {
  return ProfileSchema.parse({
    ...parsed,
    basics: { ...identity, ...parsed.basics },
    _meta: { verified: {}, source },
  })
}

/**
 * CompactProfile — dạng rút gọn gửi cho model (TDD §6.5).
 * Không chứa PII. Tên key ngắn để tiết kiệm token.
 */
export const CompactProfileSchema = z.object({
  lang: LanguageSchema,
  headline: z.string().optional(),
  edu: z.array(z.string()).default([]),
  exp: z
    .array(
      z.object({
        r: z.string(),
        o: z.string(),
        d: z.string().optional(),
        h: z.array(z.string()),
      }),
    )
    .default([]),
  proj: z
    .array(
      z.object({
        n: z.string(),
        t: z.array(z.string()),
        h: z.array(z.string()),
      }),
    )
    .default([]),
  skill: z.array(z.string()).default([]),
  act: z
    .array(z.object({ n: z.string(), h: z.array(z.string()) }))
    .default([]),
  cert: z.array(z.string()).default([]),
})

export type CompactProfile = z.infer<typeof CompactProfileSchema>
