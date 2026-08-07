import type { Pool } from 'pg'
import { PatchProposalSchema, type PatchOp, type PatchProposal } from '@hr/schema'
import { jsonb } from './pool.js'

/**
 * Repository cho phiên chat và đề xuất patch — TDD §8.3, UC-51/52/53.
 */

export type ChatRole = 'user' | 'assistant' | 'system'

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  tokenCount: number | null
  createdAt: Date
}

export interface ChatSession {
  id: string
  profileId: string
  jdId: string | null
  title: string | null
  compactedSummary: unknown | null
  compactedUptoMessageId: string | null
}

export interface ProposalRow {
  id: string
  messageId: string
  ops: PatchOp[]
  status: 'pending' | 'accepted' | 'rejected' | 'partial'
  appliedOps: number[]
}

export class ChatRepo {
  constructor(private readonly pool: Pool) {}

  // ── Phiên ─────────────────────────────────────────────────────────────

  async createSession(input: {
    userId: string
    profileId: string
    jdId?: string | null
    title?: string | null
  }): Promise<string> {
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO chat_sessions (user_id, profile_id, jd_id, title)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [input.userId, input.profileId, input.jdId ?? null, input.title ?? null],
    )
    return rows[0]!.id
  }

  /**
   * Phiên đang mở của một hồ sơ, tạo mới nếu chưa có.
   *
   * Một hồ sơ một phiên: người dùng nghĩ theo "cuộc trò chuyện về CV này", chứ
   * không quản lý nhiều phiên song song. Nhiều phiên chỉ tạo thêm màn hình
   * chọn lựa mà không giải quyết nhu cầu nào.
   */
  async openSession(userId: string, profileId: string, jdId?: string | null): Promise<string> {
    const { rows } = await this.pool.query<{ id: string }>(
      'SELECT id FROM chat_sessions WHERE profile_id = $1 ORDER BY updated_at DESC LIMIT 1',
      [profileId],
    )
    if (rows.length > 0) return rows[0]!.id
    return this.createSession({ userId, profileId, jdId: jdId ?? null })
  }

  async getSession(id: string): Promise<ChatSession | null> {
    const { rows } = await this.pool.query<{
      id: string
      profile_id: string
      jd_id: string | null
      title: string | null
      compacted_summary: unknown | null
      compacted_upto_message_id: string | null
    }>(
      `SELECT id, profile_id, jd_id, title, compacted_summary, compacted_upto_message_id
         FROM chat_sessions WHERE id = $1`,
      [id],
    )
    if (rows.length === 0) return null
    const r = rows[0]!
    return {
      id: r.id,
      profileId: r.profile_id,
      jdId: r.jd_id,
      title: r.title,
      compactedSummary: r.compacted_summary,
      compactedUptoMessageId: r.compacted_upto_message_id,
    }
  }

  // ── Tin nhắn ──────────────────────────────────────────────────────────

  async addMessage(input: {
    sessionId: string
    role: ChatRole
    content: string
    tokenCount?: number | null
  }): Promise<string> {
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO chat_messages (session_id, role, content, token_count)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [input.sessionId, input.role, input.content, input.tokenCount ?? null],
    )
    // Chạm `updated_at` để `openSession` chọn đúng phiên gần nhất
    await this.pool.query('UPDATE chat_sessions SET updated_at = now() WHERE id = $1', [
      input.sessionId,
    ])
    return rows[0]!.id
  }

  /**
   * Tin nhắn CHƯA được nén — phần phải đưa nguyên văn vào prompt.
   *
   * Tin nhắn cũ hơn `compacted_upto_message_id` đã nằm trong `compacted_summary`;
   * đưa lại cả hai là tính token hai lần cho cùng một nội dung.
   */
  async recentMessages(sessionId: string, limit = 20): Promise<ChatMessage[]> {
    const { rows } = await this.pool.query<{
      id: string
      role: ChatRole
      content: string
      token_count: number | null
      created_at: Date
    }>(
      `SELECT m.id, m.role, m.content, m.token_count, m.created_at
         FROM chat_messages m
         JOIN chat_sessions s ON s.id = m.session_id
        WHERE m.session_id = $1
          AND (
            s.compacted_upto_message_id IS NULL
            OR m.created_at > (
              SELECT created_at FROM chat_messages WHERE id = s.compacted_upto_message_id
            )
          )
        -- DESC + LIMIT rồi ĐẢO LẠI (xem .reverse() bên dưới).
        -- ORDER BY created_at LIMIT n lấy n tin nhắn CŨ NHẤT, không phải mới
        -- nhất. Phiên dài hơn limit là model nhận toàn ngữ cảnh đầu phiên, còn
        -- câu người dùng VỪA GÕ thì không có trong đó — và messageIds cũng
        -- thiếu nó, nên mọi dẫn nguồn tới câu hiện tại đều bị coi là bịa.
        -- Đo thật ở phiên 84 tin nhắn.
        ORDER BY m.created_at DESC
        LIMIT $2`,
      [sessionId, limit],
    )
    return rows.reverse().map((r) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      tokenCount: r.token_count,
      createdAt: r.created_at,
    }))
  }

  async allMessages(sessionId: string): Promise<ChatMessage[]> {
    const { rows } = await this.pool.query<{
      id: string
      role: ChatRole
      content: string
      token_count: number | null
      created_at: Date
    }>(
      `SELECT id, role, content, token_count, created_at
         FROM chat_messages WHERE session_id = $1 ORDER BY created_at`,
      [sessionId],
    )
    return rows.map((r) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      tokenCount: r.token_count,
      createdAt: r.created_at,
    }))
  }

  async saveCompaction(
    sessionId: string,
    summary: unknown,
    uptoMessageId: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE chat_sessions
          SET compacted_summary = $2, compacted_upto_message_id = $3
        WHERE id = $1`,
      [sessionId, jsonb(summary), uptoMessageId],
    )
  }

  // ── Đề xuất patch ─────────────────────────────────────────────────────

  async saveProposal(messageId: string, proposal: PatchProposal): Promise<string> {
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO proposed_patches (message_id, ops) VALUES ($1,$2) RETURNING id`,
      [messageId, jsonb(proposal.ops)],
    )
    return rows[0]!.id
  }

  async getProposal(id: string): Promise<ProposalRow | null> {
    const { rows } = await this.pool.query<{
      id: string
      message_id: string
      ops: unknown
      status: ProposalRow['status']
      applied_ops: number[]
    }>(
      'SELECT id, message_id, ops, status, applied_ops FROM proposed_patches WHERE id = $1',
      [id],
    )
    if (rows.length === 0) return null
    const r = rows[0]!
    const ops = PatchProposalSchema.shape.ops.parse(r.ops)
    return {
      id: r.id,
      messageId: r.message_id,
      ops,
      status: r.status,
      appliedOps: r.applied_ops ?? [],
    }
  }

  /**
   * Ghi lại quyết định của user — UC-53 bước 7.
   *
   * `appliedIndexes` là chỉ số các op ĐƯỢC CHỌN. Lưu chỉ số thay vì nội dung:
   * nội dung đã nằm ở `ops`, và lưu hai bản sẽ lệch nhau khi cần sửa.
   */
  async settleProposal(id: string, appliedIndexes: number[]): Promise<void> {
    const p = await this.getProposal(id)
    if (!p) throw new Error(`Không có đề xuất ${id}`)

    const status =
      appliedIndexes.length === 0
        ? 'rejected'
        : appliedIndexes.length === p.ops.length
          ? 'accepted'
          : 'partial'

    await this.pool.query(
      'UPDATE proposed_patches SET status = $2, applied_ops = $3 WHERE id = $1',
      [id, status, jsonb(appliedIndexes)],
    )
  }

  async pendingProposals(sessionId: string): Promise<ProposalRow[]> {
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT p.id FROM proposed_patches p
         JOIN chat_messages m ON m.id = p.message_id
        WHERE m.session_id = $1 AND p.status = 'pending'
        ORDER BY p.created_at`,
      [sessionId],
    )
    const out: ProposalRow[] = []
    for (const r of rows) {
      const p = await this.getProposal(r.id)
      if (p) out.push(p)
    }
    return out
  }
}
