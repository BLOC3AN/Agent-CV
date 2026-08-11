/**
 * Độ hoàn thiện hồ sơ — bao nhiêu phần trăm những thứ ATS và nhà tuyển dụng
 * luôn tìm đã có mặt trong CV.
 *
 * Đây là THUỘC TÍNH CỦA TÀI LIỆU, không phải một phân tích bất đồng bộ: hàm
 * thuần, đọc thẳng từ CV, không gọi máy chủ và không cần AI. Nhờ vậy con số
 * đổi ngay khi người dùng gõ, giống thanh tiến độ chứ không giống nút "Phân
 * tích" phải chờ.
 *
 * NÓ ĐO ĐỘ ĐẦY ĐỦ, KHÔNG ĐO CHẤT LƯỢNG. Một CV điền kín mọi ô bằng chữ vô
 * nghĩa vẫn đạt 100. Chấm chất lượng cần AI và là một tính năng khác — đừng
 * đặt tên hay nhãn cho chỉ số này theo kiểu hàm ý đã thẩm định nội dung.
 */

import type { CV } from '../types'

const filled = (value: unknown): boolean => typeof value === 'string' && value.trim() !== ''

/**
 * Trọng số cộng lại đúng 100. Chúng phản ánh mức thiệt hại khi thiếu: không có
 * liên hệ thì ATS loại ngay, còn thiếu mục học vấn chỉ làm hồ sơ mỏng đi.
 */
const WEIGHTS = {
  contact: 20,
  headline: 10,
  summary: 10,
  experienceCore: 25,
  experienceBullets: 15,
  education: 10,
  skills: 10,
} as const

export function cvCompleteness(cv: CV): number {
  const { intro, experience, education, skills } = cv.sections

  // Theo tỉ lệ chứ không phải có/không: thiếu một trường liên hệ khác hẳn
  // thiếu cả ba, và người dùng cần thấy điểm nhích lên khi điền từng ô.
  const contactFields = [intro.fullName, intro.email, intro.phone]
  const contact = contactFields.filter(filled).length / contactFields.length

  // Mục kinh nghiệm chỉ tính là đủ khi có cả thời gian: ngày tháng thiếu là
  // lỗi làm ATS đọc sai nhiều nhất, hơn cả thiếu chức danh.
  const hasCore = (item: (typeof experience)[number]) =>
    filled(item.title) && filled(item.company) && (filled(item.startDate) || item.current === true)

  const withBullets = experience.filter((item) => (item.highlights?.length ?? 0) > 0).length

  const score =
    WEIGHTS.contact * contact
    + WEIGHTS.headline * (filled(intro.title) ? 1 : 0)
    + WEIGHTS.summary * (filled(intro.summary) ? 1 : 0)
    + WEIGHTS.experienceCore * (experience.some(hasCore) ? 1 : 0)
    + WEIGHTS.experienceBullets * (experience.length ? withBullets / experience.length : 0)
    + WEIGHTS.education * (education.some((item) => filled(item.school)) ? 1 : 0)
    + WEIGHTS.skills * (skills.some((group) => group.skills.length > 0) ? 1 : 0)

  return Math.round(score)
}
