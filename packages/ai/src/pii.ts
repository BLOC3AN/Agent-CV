import type { Profile, CompactProfile } from '@hr/schema'
import * as P from './patterns.js'

/**
 * TDD §15.2 — Quy tắc cứng R1:
 *   "Trước MỌI lời gọi model (kể cả local), Profile phải đi qua stripPII().
 *    Model không cần biết tên/SĐT/địa chỉ để đánh giá CV."
 *
 * Đồng thời đây là bước nén chính (TDD §6.5): bỏ PII + rút gọn key + bỏ field rỗng.
 */

/** Các key trong `basics` KHÔNG BAO GIỜ được gửi tới model */
const PII_KEYS = ['name', 'email', 'phone', 'location', 'dob', 'photo'] as const

const dropEmpty = <T>(arr: T[]): T[] => arr.filter(Boolean)

function joinParts(...parts: (string | undefined | null)[]): string {
  return parts.filter((p) => p != null && p !== '').join(' | ')
}

/**
 * Bỏ PII nhưng GIỮ NGUYÊN hình dạng Profile — dùng cho task sinh JSON Patch.
 *
 * `stripPII` rút gọn tên key (`work` → `exp`, `highlights` → `h`) để tiết kiệm
 * token. Điều đó vô hại với task chỉ ĐỌC, nhưng chết người với task phải trả
 * về JSON Pointer: model viết `/exp[0]/h[0]` theo đúng thứ nó nhìn thấy, và
 * đường dẫn đó không tồn tại trong hồ sơ thật.
 *
 * Đo trên model thật: 3/3 op đều trỏ vào đường dẫn rút gọn → 0 op áp dụng
 * được → tính năng chat vô dụng, mà không có lỗi nào ở đâu cả.
 *
 * Đắt hơn về token, nhưng đó là cái giá để đường dẫn có nghĩa.
 */
export function redactKeepShape(profile: Profile): Record<string, unknown> {
  const { name, email, phone, location, dob, photo, ...safeBasics } = profile.basics
  void name
  void email
  void phone
  void location
  void dob
  void photo

  return {
    language: profile.language,
    basics: safeBasics,
    education: profile.education,
    work: profile.work,
    projects: profile.projects,
    skills: profile.skills,
    activities: profile.activities,
    certifications: profile.certifications,
    languages: profile.languages,
  }
}

/**
 * Profile → CompactProfile. Bỏ PII, rút gọn tên key, bỏ field rỗng.
 * TDD §6.5 — mục tiêu giảm ≥35% token.
 *
 * CHỈ dùng cho task ĐỌC hồ sơ (gap_analysis, plan_agent_step). Task nào phải
 * trả về JSON Pointer thì dùng `redactKeepShape`.
 */
export function stripPII(profile: Profile): CompactProfile {
  return {
    lang: profile.language,
    ...(profile.basics.headline ? { headline: profile.basics.headline } : {}),
    edu: dropEmpty(
      profile.education.map((e) =>
        joinParts(
          e.degree,
          e.school,
          e.major,
          e.endDate ?? e.startDate,
          e.gpa ? `GPA ${e.gpa}` : undefined,
        ),
      ),
    ),
    exp: profile.work.map((w) => ({
      r: w.role,
      o: w.org,
      ...(w.startDate || w.endDate
        ? { d: joinParts(w.startDate, w.endDate) }
        : {}),
      h: dropEmpty(w.highlights),
    })),
    proj: profile.projects.map((p) => ({
      n: p.name,
      t: dropEmpty(p.tech),
      h: dropEmpty(p.highlights),
    })),
    skill: dropEmpty(profile.skills.map((s) => s.canonical ?? s.name)),
    act: profile.activities.map((a) => ({
      n: joinParts(a.name, a.role),
      h: dropEmpty(a.highlights),
    })),
    cert: dropEmpty(
      profile.certifications.map((c) => joinParts(c.name, c.issuer)),
    ),
  }
}

/**
 * Guard chạy ngay trước khi gửi payload đi — TDD §15.2 R1, TC-SEC-01.
 * Nếu phát hiện PII lọt vào chuỗi prompt thì NÉM LỖI, không gửi.
 */
export interface PIILeak {
  kind: string
  sample: string
}

/**
 * Mẫu lấy từ `patterns.ts` — CÙNG bộ với lớp che ở `redact.ts`.
 *
 * Trước đây guard có bản sao riêng, yếu hơn: `(?:\+?84|0)[35789]\d{8}` đòi chữ
 * số mạng đứng NGAY sau mã nước, nên bỏ sót "(+84) 919275773" và
 * "+84 815599465" — đúng hai dạng mà lớp che đã học cách bắt. Một hàng phòng
 * thủ cuối chỉ bắt được thứ lớp trước đã bắt thì không phòng thủ gì cả.
 */
export function detectPII(text: string): PIILeak[] {
  const leaks: PIILeak[] = []
  const phone = text.match(P.phone())
  if (phone?.[0]) leaks.push({ kind: 'phone', sample: phone[0] })
  const email = text.match(P.email())
  if (email?.[0]) leaks.push({ kind: 'email', sample: email[0] })
  const dob = text.match(P.dob())
  if (dob?.[0]) leaks.push({ kind: 'dob', sample: dob[0] })
  return leaks
}

/**
 * Kiểm tra một Profile-like object không còn field PII nào.
 * Dùng trong test TC-SEC-01 và trong gateway trước khi gửi.
 */
export function assertNoPIIFields(obj: unknown, path = ''): void {
  if (obj == null || typeof obj !== 'object') return
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => assertNoPIIFields(v, `${path}/${i}`))
    return
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if ((PII_KEYS as readonly string[]).includes(k) && v != null && v !== '') {
      throw new Error(
        `PII_GUARD: field "${path}/${k}" chứa PII và không được gửi tới model`,
      )
    }
    assertNoPIIFields(v, `${path}/${k}`)
  }
}
