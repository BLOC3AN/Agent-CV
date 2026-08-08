/**
 * Tiện ích PII cho bộ đánh giá.
 *
 * Phần CHE PII đã chuyển sang `@hr/ai` vì worker cần nó ở production, không
 * chỉ khi đánh giá — giữ hai bản sao là cách chắc chắn để chúng lệch nhau.
 * File này chỉ còn phần sinh danh tính GIẢ, vốn chỉ dùng cho fixture.
 */
export { redactPII, redactSections, identityFromMap } from '@hr/ai'
export type { RedactionMap, RedactResult, Identity } from '@hr/ai'

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
