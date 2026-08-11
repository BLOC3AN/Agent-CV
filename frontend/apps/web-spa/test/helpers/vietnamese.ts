/**
 * Lưới bắt chữ tiếng Việt còn sót khi giao diện đang ở chế độ tiếng Anh.
 *
 * Kiểm theo HÀNH VI — soi văn bản đã render — chứ không quét mã nguồn, vì repo
 * này viết chú thích bằng tiếng Việt nên quét mã sẽ báo động giả khắp nơi.
 *
 * Giá trị lớn nhất của nó không phải là chặn hồi quy mà là DẪN ĐƯỜNG: nó tự in
 * ra chuỗi nào chưa dịch, thay vì bắt người sửa tự liệt kê — cách tự liệt kê đã
 * bỏ sót hơn một chục chuỗi ở lượt trước.
 */
const VIETNAMESE = /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/i

/**
 * Tên ngôn ngữ luôn viết bằng chính ngôn ngữ đó — "Tiếng Việt" trong danh sách
 * chọn là ĐÚNG kể cả khi giao diện đang tiếng Anh, giống như "English" không bị
 * dịch sang tiếng Việt. Đây là ngoại lệ duy nhất, cố ý liệt kê tường minh.
 */
const ENDONYMS = new Set(['Tiếng Việt'])

/** Văn bản người dùng nhìn thấy, tách theo từng text node để chỉ đúng chỗ sai. */
export function vietnameseIn(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>('*')]
    .flatMap((element) => [...element.childNodes])
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent?.trim() ?? '')
    .filter((text) => text && !ENDONYMS.has(text) && VIETNAMESE.test(text))
}

/**
 * Nhãn trợ năng cũng phải dịch: người dùng trình đọc màn hình không thấy được
 * chữ trên nút, họ chỉ nghe `aria-label`.
 */
export function vietnameseLabelsIn(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>('[aria-label], [title], [placeholder]')]
    .flatMap((element) => ['aria-label', 'title', 'placeholder'].map((name) => element.getAttribute(name) ?? ''))
    .filter((value) => value && !ENDONYMS.has(value) && VIETNAMESE.test(value))
}
