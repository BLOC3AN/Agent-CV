import { z } from 'zod'
import { LanguageSchema } from './common.js'
import { RoleFamilySchema, SenioritySchema } from './jd.js'

/**
 * Knowledge Base — TDD §10.
 *
 * Phân biệt cốt lõi:
 *  - Rubric   = DỮ LIỆU CÓ CẤU TRÚC → scoring engine dùng trực tiếp, KHÔNG embed
 *  - Guideline/Exemplar = văn xuôi   → đưa vào prompt, có trích dẫn
 */

export const KBStatusSchema = z.enum([
  'draft',
  'pending_review',
  'active',
  'archived',
])
export type KBStatus = z.infer<typeof KBStatusSchema>

export const KBContentTypeSchema = z.enum(['guideline', 'exemplar', 'red_flag'])

export const CVSectionSchema = z.enum([
  'intro',
  'education',
  'experience',
  'projects',
  'skills',
  'activities',
  'certifications',
  'all',
])
export type CVSection = z.infer<typeof CVSectionSchema>

// ── Rubric ──────────────────────────────────────────────────────────────────

export const RubricCriterionTypeSchema = z.enum([
  'count',
  'ratio',
  'page_count',
  'required_fields',
  'custom',
])

export const BilingualTextSchema = z.object({
  vi: z.string(),
  en: z.string(),
})

export const RubricCriterionSchema = z.object({
  id: z.string(),
  label: BilingualTextSchema,
  type: RubricCriterionTypeSchema,
  path: z.string().optional(),
  matcher: z.string().optional(),
  rule: z.string().optional(),
  fields: z.array(z.string()).optional(),
  recommended: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  weight: z.number().min(0).max(1),
  advice_when_below: BilingualTextSchema.optional(),
  advice_when_above: BilingualTextSchema.optional(),
})

export const RubricSchema = z.object({
  industry: z.string(),
  role_family: RoleFamilySchema,
  seniority: SenioritySchema,
  criteria: z.array(RubricCriterionSchema).min(1),
  weights_note: BilingualTextSchema.optional(),
})

export type Rubric = z.infer<typeof RubricSchema>
export type RubricCriterion = z.infer<typeof RubricCriterionSchema>

// ── Guideline / Exemplar / Red flag ─────────────────────────────────────────

export const GuidelineSchema = z.object({
  id: z.string(),
  section: z.array(z.string()),
  role_family: z.array(z.string()),
  seniority: z.array(z.string()),
  priority: z.number().int().min(0).max(100).default(50),
  text: BilingualTextSchema,
})

export const ExemplarSchema = z.object({
  id: z.string(),
  section: z.string(),
  role_family: z.array(z.string()).default([]),
  language: LanguageSchema,
  before: z.string(),
  after: z.string(),
  explanation: z.string(),
})

export const RedFlagSchema = z.object({
  id: z.string(),
  severity: z.enum(['high', 'medium', 'low']),
  detector: z.string(),
  rule: z.string().optional(),
  message: BilingualTextSchema,
})

export const ClarifyingQuestionSetSchema = z.object({
  trigger: z.string(),
  questions: z.object({
    vi: z.array(z.string()),
    en: z.array(z.string()),
  }),
})

// ── File seed (kb/seed/*.yaml) ──────────────────────────────────────────────

export const KBSourceMetaSchema = z.object({
  id: z.string(),
  title: z.string(),
  author_name: z.string().nullable(),
  author_title: z.string().nullable(),
  language: LanguageSchema,
  status: KBStatusSchema,
  version: z.number().int(),
  reviewed_at: z.string().nullable(),
  scope: z.object({
    industry: z.array(z.string()),
    role_family: z.array(z.string()),
    seniority: z.array(z.string()),
  }),
})

export const KBSeedFileSchema = z.object({
  source: KBSourceMetaSchema,
  rubrics: z.array(RubricSchema).default([]),
  guidelines: z.array(GuidelineSchema).default([]),
  exemplars: z.array(ExemplarSchema).default([]),
  red_flags: z.array(RedFlagSchema).default([]),
  clarifying_questions: z.array(ClarifyingQuestionSetSchema).default([]),
  review_notes: z.unknown().optional(),
})

export type KBSeedFile = z.infer<typeof KBSeedFileSchema>

// ── Selector (TDD §10.2) ────────────────────────────────────────────────────

export const KBChunkSchema = z.object({
  id: z.string(),
  contentType: KBContentTypeSchema,
  text: z.string(),
  sourceId: z.string(),
  authorName: z.string().nullable(),
  authorTitle: z.string().nullable(),
  priority: z.number().int(),
  tokenCount: z.number().int().optional(),
})

export type KBChunk = z.infer<typeof KBChunkSchema>

export interface KBContext {
  industry: string
  roleFamily: string
  seniority: string
  sections: string[]
  language: 'vi' | 'en'
  /** Chỉ dùng khi strategy = hybrid_retrieval */
  query?: string
}

export interface SelectedKnowledge {
  /** LUÔN lấy bằng SQL filter, không bao giờ qua vector */
  rubric: Rubric | null
  guidelines: KBChunk[]
  exemplars: KBChunk[]
  tokensUsed: number
  strategy: 'context_injection' | 'hybrid_retrieval'
}

/**
 * Interface không đổi giữa hai chiến lược.
 * v1: SqlFilterSelector · v2: HybridRetrievalSelector
 */
export interface KnowledgeSelector {
  select(ctx: KBContext, budgetTokens: number): Promise<SelectedKnowledge>
}
