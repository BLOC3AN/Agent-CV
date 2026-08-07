/**
 * Che PII trong text CV trước khi gửi model — TDD §15.2 R1.
 *
 * Đây là bước [3] của luồng import ở TDD §8.1, làm bằng CODE chứ không nhờ
 * model: model có thể bỏ sót, và gửi PII đi rồi thì không rút lại được.
 *
 * Cặp hàm redact/rehydrate cho phép gắn lại danh tính (thật hoặc giả) sau khi
 * model trả kết quả.
 */

export interface RedactionMap {
  NAME?: string
  EMAIL?: string[]
  PHONE?: string[]
  DOB?: string[]
  LOCATION?: string[]
  URL?: string[]
}

export interface RedactResult {
  text: string
  map: RedactionMap
  count: number
}

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]{2,}/g
const PHONE = /(?:\+?84|0)(?:3|5|7|8|9)[\d\s.-]{8,12}\b/g
const DOB = /\b(?:0?[1-9]|[12]\d|3[01])[/\-.](?:0?[1-9]|1[0-2])[/\-.](?:19|20)\d{2}\b/g

/** Địa chỉ đường phố VN — có số nhà/ngõ/phường thì mới coi là PII */
const STREET =
  /\b(?:số\s*\d+|ngõ\s*\d+|đường\s+[\p{L}\s]+|phố\s+[\p{L}\s]+|p\.?\s*\d+|q\.?\s*\d+|quận\s+[\p{L}\d]+|phường\s+[\p{L}\d]+)[^\n,]{0,40}/giu

/**
 * Tên người ở CV hầu như luôn nằm ở dòng đầu, in đậm, không có động từ.
 * Heuristic: 2–5 từ viết hoa chữ cái đầu trong 3 dòng đầu tiên.
 */
const NAME_LINE = /^[\p{Lu}][\p{L}']+(?:\s+[\p{Lu}][\p{L}']+){1,4}$/u

export function redactPII(text: string): RedactResult {
  const map: RedactionMap = {}
  let count = 0

  const lines = text.split('\n')
  for (let i = 0; i < Math.min(4, lines.length); i++) {
    const t = (lines[i] ?? '').trim()
    if (t.length >= 4 && t.length <= 60 && NAME_LINE.test(t)) {
      map.NAME = t
      lines[i] = (lines[i] ?? '').replace(t, '<NAME>')
      count++
      break
    }
  }
  let out = lines.join('\n')

  const swap = (
    re: RegExp,
    token: keyof RedactionMap,
    placeholder: string,
  ): void => {
    const found = out.match(re)
    if (!found) return
    ;(map[token] as string[]) = [...new Set(found.map((s) => s.trim()))]
    out = out.replace(re, placeholder)
    count += found.length
  }

  swap(EMAIL, 'EMAIL', '<EMAIL>')
  swap(PHONE, 'PHONE', '<PHONE>')
  swap(DOB, 'DOB', '<DOB>')
  swap(STREET, 'LOCATION', '<LOCATION>')

  return { text: out, map, count }
}

/** Danh tính giả — dùng cho fixture đánh giá, KHÔNG dùng ở production */
export interface FakeIdentity {
  name: string
  email: string
  phone: string
  location: string
  dob: string
}

const FAKE_NAMES = [
  'Nguyễn Minh Khôi',
  'Trần Thị Thu Hà',
  'Lê Quang Duy',
  'Phạm Ngọc Anh',
  'Vũ Hoàng Nam',
  'Đặng Thuỳ Linh',
  'Bùi Anh Tuấn',
  'Hoàng Thị Mai',
  'Đỗ Văn Thành',
  'Ngô Bảo Châu',
]

const FAKE_CITIES = ['Hà Nội', 'TP. Hồ Chí Minh', 'Đà Nẵng', 'Cần Thơ', 'Hải Phòng']

/** Sinh danh tính giả ổn định theo seed — cùng seed thì cùng kết quả */
export function fakeIdentity(seed: number): FakeIdentity {
  const name = FAKE_NAMES[seed % FAKE_NAMES.length]!
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .split(' ')
    .reverse()
    .join('')
  return {
    name,
    email: `${slug}${(seed % 90) + 10}@gmail.com`,
    phone: `09${String(10_000_000 + ((seed * 7_919) % 89_999_999)).slice(0, 8)}`,
    location: FAKE_CITIES[seed % FAKE_CITIES.length]!,
    dob: `${(seed % 28) + 1}/${(seed % 12) + 1}/200${seed % 5}`,
  }
}

/** Thay placeholder trong Profile bằng danh tính giả */
export function injectFakeIdentity<T extends { basics: Record<string, unknown> }>(
  profile: T,
  id: FakeIdentity,
): T {
  const b = profile.basics
  const isPlaceholder = (v: unknown) =>
    typeof v === 'string' && /^<(NAME|EMAIL|PHONE|LOCATION|DOB)>$/.test(v.trim())

  if (!b['name'] || isPlaceholder(b['name'])) b['name'] = id.name
  if (!b['email'] || isPlaceholder(b['email'])) b['email'] = id.email
  if (!b['phone'] || isPlaceholder(b['phone'])) b['phone'] = id.phone
  if (!b['location'] || isPlaceholder(b['location'])) b['location'] = id.location
  return profile
}
