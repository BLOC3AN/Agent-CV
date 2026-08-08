/**
 * Mẫu nhận diện PII — NGUỒN SỰ THẬT DUY NHẤT.
 *
 * Tách riêng vì hai nơi cùng cần và chúng PHẢI khớp nhau:
 *   · `redact.ts`  — che PII trước khi dựng prompt
 *   · `pii.ts`     — guard chạy ngay trước khi gửi, hàng phòng thủ cuối
 *
 * Từng có hai bản sao và chúng lệch nhau: bản trong `redact.ts` được siết sau
 * khi đo trên CV thật, bản guard thì không. Kết quả là guard bỏ sót đúng những
 * dạng số điện thoại mà lớp che đã học cách bắt — một hàng phòng thủ cuối chỉ
 * bắt được thứ lớp trước đã bắt thì không phòng thủ gì cả.
 *
 * Mọi hàm ở đây trả về regex MỚI: cờ `g` mang trạng thái `lastIndex`, dùng
 * chung một đối tượng giữa nhiều lời gọi sẽ cho kết quả khác nhau tuỳ thứ tự.
 */

export const email = (): RegExp => /[\w.+-]+@[\w-]+\.[\w.]{2,}/g

/**
 * Số điện thoại VN. Sáu cách viết khác nhau trên sáu CV thật — có ngoặc, có
 * dấu cách, có dấu chấm, mã nước liền hoặc rời. Xem TDD §15.2.1.
 */
export const phone = (): RegExp =>
  /(?<![\d+])(?:\(\s*\+?84\s*\)|\+\s*84|84(?=[\s.-])|0)[\s.-]*[35789][\d\s.-]{7,11}\d/g

export const dob = (): RegExp =>
  /\b(?:0?[1-9]|[12]\d|3[01])[/\-.](?:0?[1-9]|1[0-2])[/\-.](?:19|20)\d{2}\b/g

/** Địa chỉ đường phố VN — chỉ tính khi có số nhà / tên đơn vị hành chính. */
export const street = (): RegExp =>
  new RegExp(
    '(?:' +
      '\\b(?:số|ngõ)\\s*\\d+[^\\n,]{0,40}' +
      '|\\b(?:đường|phố|quận|phường)\\s+[\\p{L}\\d][^\\n,]{0,40}' +
      // Viết tắt quận/phường BẮT BUỘC có dấu chấm: "Q.7" hầu như chỉ là địa chỉ,
      // còn "Q4", "P3", "H2" trong CV IT là quý, mức ưu tiên, tên công nghệ.
      '|(?<![\\p{L}\\d])[qp]\\.\\s*\\d{1,2}(?![\\p{L}\\d])' +
      ')',
    'giu',
  )
