import type { Pool } from 'pg'
import { ProfileSchema, type JDRequirements, type MatchResult, type Profile } from '@hr/schema'

/**
 * Repository cho JD, kết quả đối chiếu, và bản CV theo JD — TDD §8.2, §8.5.
 */

export interface JdRow {
  id: string
  rawText: string
  requirements: JDRequirements | null
  roleFamily: string | null
  seniority: string | null
  language: string
}

export class MatchRepo {
  constructor(private readonly pool: Pool) {}

  // ── JD ────────────────────────────────────────────────────────────────

  async saveJd(input: {
    userId: string | null
    rawText: string
    sourceUrl?: string
    language?: string
    requirements?: JDRequirements | null
  }): Promise<string> {
    const req = input.requirements ?? null
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO job_descriptions
         (user_id, raw_text, source_url, language, requirements, role_family, seniority)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        input.userId,
        input.rawText,
        input.sourceUrl ?? null,
        input.language ?? req?.language ?? 'vi',
        req,
        req?.roleFamily ?? null,
        req?.seniority ?? null,
      ],
    )
    return rows[0]!.id
  }

  async getJd(id: string): Promise<JdRow | null> {
    const { rows } = await this.pool.query<{
      id: string
      raw_text: string
      requirements: JDRequirements | null
      role_family: string | null
      seniority: string | null
      language: string
    }>(
      `SELECT id, raw_text, requirements, role_family, seniority, language
         FROM job_descriptions WHERE id = $1`,
      [id],
    )
    if (rows.length === 0) return null
    const r = rows[0]!
    return {
      id: r.id,
      rawText: r.raw_text,
      requirements: r.requirements,
      roleFamily: r.role_family,
      seniority: r.seniority,
      language: r.language,
    }
  }

  async setJdRequirements(id: string, req: JDRequirements): Promise<void> {
    await this.pool.query(
      `UPDATE job_descriptions
          SET requirements = $2, role_family = $3, seniority = $4, language = $5
        WHERE id = $1`,
      [id, req, req.roleFamily, req.seniority, req.language],
    )
  }

  // ── Bản CV riêng cho một JD (UC-33) ───────────────────────────────────

  /**
   * Nhân bản hồ sơ + tạo CV mới gắn JD — TDD §8.5, quyết định D12.
   *
   * Nhân bản là IM LẶNG (BR-33.1): người dùng chỉ thấy mình đang sửa CV, không
   * phải hiểu khái niệm "hồ sơ" và "tài liệu CV".
   *
   * Chạy trong MỘT transaction: nếu tạo được hồ sơ mà hỏng ở bước tạo CV, sẽ
   * còn lại một hồ sơ mồ côi không ai trỏ tới và không cách nào dọn.
   */
  async cloneForJd(input: {
    sourceCvId: string
    jdId: string
    title: string
  }): Promise<{ cvId: string; profileId: string; created: boolean }> {
    // BR-33.2: một (CV gốc, JD) chỉ sinh một bản. Dán lại cùng JD → mở bản cũ.
    const existing = await this.pool.query<{ id: string; profile_id: string }>(
      `SELECT id, profile_id FROM cv_documents
        WHERE jd_id = $1 AND cloned_from = $2 LIMIT 1`,
      [input.jdId, input.sourceCvId],
    )
    if (existing.rows.length > 0) {
      return {
        cvId: existing.rows[0]!.id,
        profileId: existing.rows[0]!.profile_id,
        created: false,
      }
    }

    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')

      const src = await client.query<{
        user_id: string
        profile_id: string
        template_id: string
        theme: unknown
        layout: unknown
        data: unknown
        language: string
      }>(
        `SELECT c.user_id, c.profile_id, c.template_id, c.theme, c.layout,
                p.data, p.language
           FROM cv_documents c JOIN profiles p ON p.id = c.profile_id
          WHERE c.id = $1`,
        [input.sourceCvId],
      )
      if (src.rows.length === 0) throw new Error(`Không có CV ${input.sourceCvId}`)
      const s = src.rows[0]!

      const prof = await client.query<{ id: string }>(
        `INSERT INTO profiles (user_id, data, schema_version, language)
         VALUES ($1, $2, 1, $3) RETURNING id`,
        [s.user_id, s.data, s.language],
      )
      const profileId = prof.rows[0]!.id

      const cv = await client.query<{ id: string }>(
        `INSERT INTO cv_documents
           (user_id, profile_id, profile_snapshot, template_id, theme, layout,
            jd_id, language, title, cloned_from)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [
          s.user_id,
          profileId,
          s.data,
          s.template_id,
          s.theme,
          s.layout,
          input.jdId,
          s.language,
          input.title,
          input.sourceCvId,
        ],
      )

      await client.query('COMMIT')
      return { cvId: cv.rows[0]!.id, profileId, created: true }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }
  }

  // ── Kết quả đối chiếu ─────────────────────────────────────────────────

  /**
   * BR-42.4: cache theo `(cv_id, jd_id, revision_id)`.
   *
   * `revision_id` là mấu chốt — sửa CV xong phải phân tích LẠI. Cache chỉ theo
   * `(cv, jd)` sẽ trả kết quả của bản CV cũ, và user tưởng lời khuyên của mình
   * không có tác dụng gì.
   */
  async findCached(
    cvId: string,
    jdId: string,
    revisionId: string | null,
  ): Promise<MatchResult | null> {
    const { rows } = await this.pool.query<{ score: MatchResult }>(
      `SELECT jsonb_build_object(
                'overall', score->'overall',
                'breakdown', score->'breakdown',
                'matched', matched,
                'gaps', gaps,
                'missingAtsKeywords', COALESCE(score->'missingAtsKeywords','[]'::jsonb),
                'degraded', degraded,
                'degradedReason', score->'degradedReason'
              ) AS score
         FROM match_analyses
        WHERE cv_id = $1 AND jd_id = $2
          AND revision_id IS NOT DISTINCT FROM $3::bigint
        LIMIT 1`,
      [cvId, jdId, revisionId],
    )
    return rows.length ? rows[0]!.score : null
  }

  async saveMatch(input: {
    cvId: string
    jdId: string
    revisionId: string | null
    result: MatchResult
    modelUsed?: string | null
  }): Promise<string> {
    const { result } = input
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO match_analyses
         (cv_id, jd_id, revision_id, score, matched, gaps, degraded, model_used)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (cv_id, jd_id, revision_id) DO UPDATE
         SET score = EXCLUDED.score,
             matched = EXCLUDED.matched,
             gaps = EXCLUDED.gaps,
             degraded = EXCLUDED.degraded,
             created_at = now()
       RETURNING id`,
      [
        input.cvId,
        input.jdId,
        input.revisionId,
        {
          overall: result.overall,
          breakdown: result.breakdown,
          missingAtsKeywords: result.missingAtsKeywords,
          degradedReason: result.degradedReason,
        },
        // JSON.stringify BẮT BUỘC cho MẢNG: driver `pg` tự chuyển object thành
        // JSON nhưng biến mảng thành mảng POSTGRES (`{...}`), và cột jsonb từ
        // chối cú pháp đó — "invalid input syntax for type json".
        JSON.stringify(result.matched),
        JSON.stringify(result.gaps),
        result.degraded,
        input.modelUsed ?? null,
      ],
    )
    return rows[0]!.id
  }

  /** Bản sửa mới nhất của hồ sơ — dùng làm khoá cache. */
  async latestRevision(profileId: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ id: string }>(
      'SELECT id FROM profile_revisions WHERE profile_id = $1 ORDER BY id DESC LIMIT 1',
      [profileId],
    )
    return rows.length ? String(rows[0]!.id) : null
  }

  async profileOfCv(cvId: string): Promise<{ profileId: string; profile: Profile } | null> {
    const { rows } = await this.pool.query<{ profile_id: string; data: unknown }>(
      `SELECT c.profile_id, p.data
         FROM cv_documents c JOIN profiles p ON p.id = c.profile_id
        WHERE c.id = $1`,
      [cvId],
    )
    if (rows.length === 0) return null
    return { profileId: rows[0]!.profile_id, profile: ProfileSchema.parse(rows[0]!.data) }
  }
}
