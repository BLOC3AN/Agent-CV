/**
 * Cảnh báo lúc phát triển, im lặng khi chạy thật.
 *
 * Spec D7: các ràng buộc của primitive là KHUYẾN NGHỊ, không phải lỗi biên
 * dịch. Nhưng "khuyến nghị" mà không có tín hiệu nào thì bằng không có — chỗ
 * quên sẽ trôi qua review và chỉ lộ ra khi có người đọc lại.
 *
 * `console.warn` là mức đúng: người viết code thấy ngay khi mở màn hình, còn
 * người dùng cuối không thấy gì.
 */
export function devWarn(condition: boolean, message: string): void {
  if (condition && process.env.NODE_ENV !== 'production') {
    console.warn(`[ui] ${message}`)
  }
}
