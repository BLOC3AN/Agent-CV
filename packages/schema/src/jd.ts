import { z } from 'zod'
import { LanguageSchema } from './profile.js'

/**
 * JDRequirementsSchema — kết quả của task `parse_jd`.
 * TDD §8.2. Đây là schema mà model local phải trả đúng; sai thì escalate.
 */

export const SenioritySchema = z.enum([
  'intern',
  'fresher',
  'junior',
  'mid',
  'senior',
  'lead',
  'unknown',
])
export type Seniority = z.infer<typeof SenioritySchema>

export const RoleFamilySchema = z.enum([
  'backend_developer',
  'frontend_developer',
  'fullstack_developer',
  'mobile_developer',
  'data_analyst',
  'data_engineer',
  'qa_tester',
  'devops',
  'business_analyst',
  'product_manager',
  'ui_ux_designer',
  'other',
])
export type RoleFamily = z.infer<typeof RoleFamilySchema>

export const RequirementSchema = z.object({
  /** Nội dung yêu cầu, giữ nguyên từ ngữ JD dùng */
  text: z.string(),
  /** true = bắt buộc, false = ưu tiên */
  required: z.boolean().default(true),
})

export const JDRequirementsSchema = z.object({
  title: z.string(),
  language: LanguageSchema,
  roleFamily: RoleFamilySchema,
  seniority: SenioritySchema,
  domain: z.string().optional(),
  yearsRequired: z.number().min(0).max(30).nullable().default(null),

  /** Kỹ năng kỹ thuật bắt buộc */
  hardSkills: z.array(z.string()).default([]),
  /** Kỹ năng mềm */
  softSkills: z.array(z.string()).default([]),
  /** Trách nhiệm công việc */
  responsibilities: z.array(z.string()).default([]),
  /** Từ khoá ATS — dùng cho lớp keyword của matching engine */
  atsKeywords: z.array(z.string()).default([]),
  /** Ưu tiên nhưng không bắt buộc */
  niceToHave: z.array(z.string()).default([]),
  /** Yêu cầu học vấn nếu JD có nêu */
  education: z.string().optional(),
})

export type JDRequirements = z.infer<typeof JDRequirementsSchema>

/**
 * Kết quả matching — sinh bởi scoring engine (THUẦN CODE, không LLM).
 * TDD quyết định D3: điểm số deterministic; LLM chỉ diễn giải.
 */
export const EvidenceSchema = z.object({
  /** JSON Pointer trỏ tới vị trí trong Profile */
  path: z.string(),
  /** Trích đoạn để hiển thị cho user */
  excerpt: z.string(),
  /** Điểm tương đồng 0..1 (lớp semantic) hoặc 1 (khớp keyword tuyệt đối) */
  score: z.number().min(0).max(1),
})

export const MatchedItemSchema = z.object({
  requirement: z.string(),
  evidence: z.array(EvidenceSchema).min(1),
  strength: z.enum(['strong', 'moderate', 'weak']),
})

export const GapItemSchema = z.object({
  id: z.string(),
  requirement: z.string(),
  severity: z.enum(['high', 'medium', 'low']),
  reason: z.enum(['missing', 'implicit', 'below_threshold']),
  /** Lời tư vấn — điền sau bởi LLM qua SSE, ban đầu null */
  advice: z.string().nullable().default(null),
  kbRefs: z.array(z.string()).default([]),
})

export const ScoreBreakdownSchema = z.object({
  skills: z.number().min(0).max(100),
  experience: z.number().min(0).max(100),
  education: z.number().min(0).max(100),
  keywords: z.number().min(0).max(100),
  rubric: z.number().min(0).max(100),
})

export const MatchResultSchema = z.object({
  overall: z.number().min(0).max(100),
  breakdown: ScoreBreakdownSchema,
  matched: z.array(MatchedItemSchema).default([]),
  gaps: z.array(GapItemSchema).default([]),
  missingAtsKeywords: z.array(z.string()).default([]),
  /** true khi lớp semantic bị tắt do embedder chết (TDD §5.5) */
  degraded: z.boolean().default(false),
  degradedReason: z.string().nullable().default(null),
})

export type MatchResult = z.infer<typeof MatchResultSchema>
export type GapItem = z.infer<typeof GapItemSchema>
export type MatchedItem = z.infer<typeof MatchedItemSchema>

/** Kết quả của task `gap_analysis` — LLM chỉ trả lời tư vấn, KHÔNG trả điểm */
export const GapAnalysisSchema = z.object({
  advices: z
    .array(
      z.object({
        gapId: z.string(),
        advice: z.string().min(10),
        kbRefs: z.array(z.string()).default([]),
        confidence: z.enum(['high', 'medium', 'low']).default('medium'),
      }),
    )
    .default([]),
  summary: z.string().optional(),
})

export type GapAnalysis = z.infer<typeof GapAnalysisSchema>
