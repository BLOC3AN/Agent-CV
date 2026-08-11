/**
 * Thời gian tương đối cho danh sách CV.
 *
 * Port từ `when()` của bản Next. Nhận `now` qua tham số thay vì gọi
 * `Date.now()` bên trong: đó là điều kiện để test được mà không phải đóng
 * băng đồng hồ toàn cục.
 */
type Translate = (key: 'minutesAgo' | 'hoursAgo' | 'daysAgo', params: { n: number }) => string

/** Bản tiếng Việt mặc định, giữ cho các chỗ gọi chưa có hàm dịch trong tay. */
const VI: Translate = (key, { n }) =>
  key === 'minutesAgo' ? `${n} phút trước` : key === 'hoursAgo' ? `${n} giờ trước` : `${n} ngày trước`

export function relativeTime(iso: string, now: Date = new Date(), t: Translate = VI): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return '—'

  const minutes = Math.round((now.getTime() - at.getTime()) / 60_000)
  if (minutes < 60) return t('minutesAgo', { n: Math.max(minutes, 1) })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return t('hoursAgo', { n: hours })
  return t('daysAgo', { n: Math.round(hours / 24) })
}
