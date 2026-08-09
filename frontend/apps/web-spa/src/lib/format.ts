/**
 * Thời gian tương đối cho danh sách CV.
 *
 * Port từ `when()` của bản Next. Nhận `now` qua tham số thay vì gọi
 * `Date.now()` bên trong: đó là điều kiện để test được mà không phải đóng
 * băng đồng hồ toàn cục.
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return '—'

  const phut = Math.round((now.getTime() - at.getTime()) / 60_000)
  if (phut < 60) return `${Math.max(phut, 1)} phút trước`
  const gio = Math.round(phut / 60)
  if (gio < 24) return `${gio} giờ trước`
  return `${Math.round(gio / 24)} ngày trước`
}
