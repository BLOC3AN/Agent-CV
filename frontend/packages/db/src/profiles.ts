import type { Pool } from 'pg'
import { jsonb } from './pool.js'
import { ProfileSchema, type Profile, type PatchOp } from '@hr/schema'
import {
  applyProfilePatch,
  markUnverified,
  markVerified,
  replay,
  type Operation,
} from './patch.js'

/**
 * Repository cho Profile — UC-23, UC-24, UC-54.
 *
 * Mọi thay đổi đi qua `patch()`, kể cả thay đổi của người dùng, để:
 *   · một lịch sử undo duy nhất (BR-54.1)
 *   · audit trail đầy đủ: ai sửa gì, từ lượt chat nào
 */

export type PatchAuthor = 'user' | 'ai' | 'import'

export interface PatchOutcome {
  profile: Profile
  revisionId: string
  applied: PatchOp[]
  rejected: { op: PatchOp; reason: string }[]
}

export class ProfileRepo {
  constructor(private readonly pool: Pool) {}

  async create(userId: string, profile: Profile): Promise<{ id: string; profile: Profile }> {
    const parsed = ProfileSchema.parse(profile)
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO profiles (user_id, data, schema_version, language)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [userId, jsonb(parsed), parsed.schemaVersion, parsed.language],
    )
    return { id: rows[0]!.id, profile: parsed }
  }

  async get(id: string): Promise<Profile | null> {
    const { rows } = await this.pool.query<{ data: unknown }>(
      'SELECT data FROM profiles WHERE id = $1',
      [id],
    )
    if (rows.length === 0) return null
    return ProfileSchema.parse(rows[0]!.data)
  }

  /**
   * Áp patch trong MỘT transaction. Op hỏng bị bỏ riêng, phần còn lại vẫn áp
   * dụng (UC-53 6a). Không op nào áp được thì rollback và báo lỗi.
   */
  async patch(
    profileId: string,
    ops: PatchOp[],
    author: PatchAuthor,
    messageId?: string,
  ): Promise<PatchOutcome> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      // Khoá hàng để hai lượt sửa đồng thời không ghi đè nhau
      const { rows } = await client.query<{ data: unknown }>(
        'SELECT data FROM profiles WHERE id = $1 FOR UPDATE',
        [profileId],
      )
      if (rows.length === 0) throw new Error(`Không có profile ${profileId}`)

      const before = ProfileSchema.parse(rows[0]!.data)
      const res = applyProfilePatch(before, ops)
      if (!res.ok) {
        await client.query('ROLLBACK')
        throw new Error(
          `Patch thất bại: ${res.reason}. Chi tiết: ` +
            res.rejected.map((r) => `${r.op.path}: ${r.reason}`).join('; '),
        )
      }

      // AI sửa → chưa xác nhận. Người sửa → đã xác nhận (BR-24.2, TC-53-08).
      const marked =
        author === 'user'
          ? markVerified(res.profile, res.applied)
          : markUnverified(res.profile, res.applied)

      await client.query('UPDATE profiles SET data = $1, language = $2 WHERE id = $3', [
        jsonb(marked),
        marked.language,
        profileId,
      ])
      const rev = await client.query<{ id: string }>(
        `INSERT INTO profile_revisions (profile_id, patch, inverse, author, message_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [profileId, jsonb(res.applied), jsonb(res.inverse), author, messageId ?? null],
      )
      await client.query('COMMIT')

      return {
        profile: marked,
        revisionId: rev.rows[0]!.id,
        applied: res.applied,
        rejected: res.rejected,
      }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }
  }

  /**
   * Đánh dấu đã rà soát — UC-22 bước 4.
   *
   * Tách khỏi `patch()` vì "Đúng rồi" KHÔNG đổi giá trị nào: model đọc đúng,
   * user chỉ xác nhận. Ép nó qua `patch()` sẽ sinh một revision rỗng trong lịch
   * sử undo, và bấm hoàn tác sẽ "hoàn tác" một thao tác không thay đổi gì —
   * vô nghĩa với người dùng.
   *
   * `_meta.verified` là siêu dữ liệu về mức tin cậy, không phải nội dung CV,
   * nên nó nằm ngoài lịch sử patch một cách có chủ đích.
   */
  async verify(
    profileId: string,
    paths: string[],
    verified = true,
  ): Promise<Profile> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const { rows } = await client.query<{ data: unknown }>(
        'SELECT data FROM profiles WHERE id = $1 FOR UPDATE',
        [profileId],
      )
      if (rows.length === 0) throw new Error(`Không có profile ${profileId}`)

      const profile = ProfileSchema.parse(rows[0]!.data)
      const v = { ...profile._meta.verified }
      for (const p of paths) {
        if (verified) v[p] = true
        else delete v[p]
      }
      const next: Profile = { ...profile, _meta: { ...profile._meta, verified: v } }

      await client.query('UPDATE profiles SET data = $1 WHERE id = $2', [jsonb(next), profileId])
      await client.query('COMMIT')
      return next
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }
  }

  async revisions(
    profileId: string,
    limit = 50,
  ): Promise<{ id: string; author: PatchAuthor; createdAt: Date; opCount: number }[]> {
    const { rows } = await this.pool.query<{
      id: string; author: PatchAuthor; created_at: Date; patch: PatchOp[]
    }>(
      `SELECT id, author, created_at, patch FROM profile_revisions
       WHERE profile_id = $1 ORDER BY id DESC LIMIT $2`,
      [profileId, limit],
    )
    return rows.map((r) => ({
      id: r.id,
      author: r.author,
      createdAt: r.created_at,
      opCount: Array.isArray(r.patch) ? r.patch.length : 0,
    }))
  }

  /**
   * Dựng lại hồ sơ TẠI một mốc lịch sử — UC-34, để XEM TRƯỚC khi khôi phục.
   *
   * Trả về cả `before` và `after` của chính mốc đó, kèm patch đã áp. Không có
   * `before` thì không nói được "thay đổi gì": danh sách op chỉ có giá trị MỚI,
   * còn giá trị cũ nằm ở ảnh chụp trước đó.
   *
   * Cách dựng: đi ngược từ bản hiện tại, áp patch nghịch đảo của mọi mốc SAU nó.
   * Cùng đường với `revertTo` nhưng KHÔNG ghi gì — người dùng phải xem được bản
   * cũ mà không phải đánh đổi bằng việc mất các bản mới hơn.
   */
  async snapshotAt(
    profileId: string,
    revisionId: string,
  ): Promise<{
    revisionId: string
    author: PatchAuthor
    createdAt: Date
    ops: PatchOp[]
    /** Hồ sơ ngay SAU khi mốc này được áp */
    after: Profile
    /** Hồ sơ ngay TRƯỚC mốc này — null khi không dựng lại được */
    before: Profile | null
    /** Số mốc mới hơn sẽ bị bỏ nếu khôi phục về đây */
    newerCount: number
  } | null> {
    const client = await this.pool.connect()
    try {
      // Đọc nhất quán: một lượt patch chen vào giữa hai câu SELECT sẽ cho ảnh
      // chụp sai — người dùng xem một bản chưa từng tồn tại.
      await client.query('BEGIN READ ONLY')

      const rev = await client.query<{
        id: string; patch: PatchOp[]; inverse: Operation[]; author: PatchAuthor; created_at: Date
      }>(
        `SELECT id, patch, inverse, author, created_at FROM profile_revisions
         WHERE profile_id = $1 AND id = $2`,
        [profileId, revisionId],
      )
      if (rev.rows.length === 0) {
        await client.query('ROLLBACK')
        return null
      }

      const newer = await client.query<{ inverse: Operation[] }>(
        `SELECT inverse FROM profile_revisions
         WHERE profile_id = $1 AND id > $2 ORDER BY id DESC`,
        [profileId, revisionId],
      )
      const cur = await client.query<{ data: unknown }>(
        'SELECT data FROM profiles WHERE id = $1',
        [profileId],
      )
      await client.query('COMMIT')

      if (cur.rows.length === 0) return null
      const current = ProfileSchema.parse(cur.rows[0]!.data)
      const after = replay(current, newer.rows.map((r) => r.inverse))

      // Mốc đầu tiên có thể lùi về một hồ sơ chưa hợp schema (chưa có tên…).
      // Không dựng được `before` thì vẫn cho xem `after`, chỉ mất phần "giá trị cũ".
      let before: Profile | null = null
      try {
        before = replay(after, [rev.rows[0]!.inverse])
      } catch {
        before = null
      }

      return {
        revisionId: rev.rows[0]!.id,
        author: rev.rows[0]!.author,
        createdAt: rev.rows[0]!.created_at,
        ops: Array.isArray(rev.rows[0]!.patch) ? rev.rows[0]!.patch : [],
        after,
        before,
        newerCount: newer.rows.length,
      }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }
  }

  /** Undo: áp patch nghịch đảo của revision gần nhất (BR-54.1) */
  async undoLast(profileId: string): Promise<Profile | null> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const { rows } = await client.query<{ id: string; inverse: Operation[] }>(
        `SELECT id, inverse FROM profile_revisions
         WHERE profile_id = $1 ORDER BY id DESC LIMIT 1`,
        [profileId],
      )
      if (rows.length === 0) {
        await client.query('ROLLBACK')
        return null
      }
      const cur = await client.query<{ data: unknown }>(
        'SELECT data FROM profiles WHERE id = $1 FOR UPDATE',
        [profileId],
      )
      const restored = replay(ProfileSchema.parse(cur.rows[0]!.data), [rows[0]!.inverse])
      await client.query('UPDATE profiles SET data = $1 WHERE id = $2', [jsonb(restored), profileId])
      await client.query('DELETE FROM profile_revisions WHERE id = $1', [rows[0]!.id])
      await client.query('COMMIT')
      return restored
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }
  }

  /** Quay về một mốc bất kỳ — TC-54-05 */
  async revertTo(profileId: string, revisionId: string): Promise<Profile> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const { rows } = await client.query<{ inverse: Operation[] }>(
        `SELECT inverse FROM profile_revisions
         WHERE profile_id = $1 AND id >= $2 ORDER BY id DESC`,
        [profileId, revisionId],
      )
      const cur = await client.query<{ data: unknown }>(
        'SELECT data FROM profiles WHERE id = $1 FOR UPDATE',
        [profileId],
      )
      const restored = replay(
        ProfileSchema.parse(cur.rows[0]!.data),
        rows.map((r) => r.inverse),
      )
      await client.query('UPDATE profiles SET data = $1 WHERE id = $2', [jsonb(restored), profileId])
      await client.query('DELETE FROM profile_revisions WHERE profile_id = $1 AND id >= $2', [
        profileId,
        revisionId,
      ])
      await client.query('COMMIT')
      return restored
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }
  }
}
