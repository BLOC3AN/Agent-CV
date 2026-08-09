/**
 * Dịch giữa BA không gian tên đường dẫn — và chặn cái cuối cùng lọt ra giao diện.
 *
 * ── Vì sao cần ──
 * `plan_agent_step` đọc `CompactProfile` (key rút gọn: `work` → `exp`,
 * `activities` → `act`, `highlights` → `h`). Nên `targetPath` nó trả về nằm
 * trong KHÔNG GIAN TÊN RÚT GỌN, khác hẳn Profile thật:
 *
 *   plan_agent_step trả  /act        →  Profile thật là  /activities
 *   plan_agent_step trả  /exp/0/h/0  →  Profile thật là  /work/0/highlights/0
 *
 * Hậu quả đo được, cả ba đều IM LẶNG:
 *   1. `readPath(profile, '/act')` trả về rỗng → `insight_mining` soạn câu hỏi
 *      mà không biết mục đó đang có gì
 *   2. `propose_patch` nhận "Mục liên quan: /act" — một con trỏ không tồn tại
 *      trong hồ sơ mà nó đang được yêu cầu sửa
 *   3. `/act` lọt thẳng ra màn hình: *"cần biết đúng hướng đi cho vị trí /act"*
 *
 * Người dùng không nhìn thấy JSON. Với họ `/act` là một lỗi kỹ thuật rò ra.
 */

/** Key rút gọn của `stripPII` → key thật trong Profile. */
const EXPAND: Record<string, string> = {
  exp: 'work',
  proj: 'projects',
  act: 'activities',
  edu: 'education',
  skill: 'skills',
  cert: 'certifications',
  h: 'highlights',
  r: 'role',
  o: 'org',
  n: 'name',
  t: 'tech',
  d: 'date',
}

/**
 * Con trỏ trong không gian rút gọn → con trỏ trong Profile thật.
 *
 * Chỉ đổi những đoạn KHỚP HẲN một key rút gọn; số thứ tự và tên đã đúng thì
 * giữ nguyên. Nhờ vậy gọi lên một con trỏ vốn đã đúng (`/work/0`) là vô hại,
 * nên chỗ gọi không cần biết con trỏ đến từ đâu.
 */
export function expandCompactPath(pointer: string | null): string | null {
  if (!pointer) return pointer
  return pointer
    .split('/')
    .map((seg) => EXPAND[seg] ?? seg)
    .join('/')
}

/** Tên mục bằng tiếng Việt, theo đoạn ĐẦU của con trỏ. */
const SECTION_VI: Record<string, string> = {
  work: 'Kinh nghiệm',
  exp: 'Kinh nghiệm',
  projects: 'Dự án',
  proj: 'Dự án',
  activities: 'Hoạt động',
  act: 'Hoạt động',
  education: 'Học vấn',
  edu: 'Học vấn',
  skills: 'Kỹ năng',
  skill: 'Kỹ năng',
  certifications: 'Chứng chỉ',
  cert: 'Chứng chỉ',
  basics: 'Thông tin chung',
  introduce: 'Giới thiệu',
  headline: 'Chức danh',
}

/** Tên mục để HIỂN THỊ, ví dụ `/work/0/highlights/1` → "Kinh nghiệm". */
export function sectionLabel(pointer: string | null): string | null {
  if (!pointer) return null
  const top = pointer.split('/').filter(Boolean)[0]
  return top ? (SECTION_VI[top] ?? null) : null
}

/**
 * Bắt mọi con trỏ JSON trong chuỗi model viết cho NGƯỜI ĐỌC.
 *
 * Prompt đã dặn không nhắc tên field, nhưng dặn không phải là bảo đảm — model
 * 4B vẫn nhắc, và đã nhắc thật. Đây là chốt chặn ở tầng code, chạy trên mọi
 * chuỗi hiển thị bất kể task nào sinh ra nó.
 *
 * Thay bằng tên mục tiếng Việt khi nhận ra được, còn không thì bỏ hẳn — một
 * câu thiếu vài chữ vẫn đọc được, còn `/act` thì vô nghĩa với người dùng.
 */
export function humanizePointers(text: string): string {
  return text
    .replace(/\/[a-zA-Z]+(?:\/\d+)?(?:\/[a-zA-Z]+)*(?:\/\d+)?/g, (m) => sectionLabel(m) ?? '')
    .replace(/\(\s*\)|\[\s*\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim()
}
