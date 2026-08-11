/**
 * Chữ do CV tự mang: tiêu đề mục và nhãn khối.
 *
 * Đây là hàm thuần nhận `language` chứ không đọc React context, vì
 * `CVBlockRenderer` còn chạy SSR trong `src/server/print.tsx` nơi không có
 * provider nào. Cho tiêu đề bám vào `cv.language` — thứ đã được truyền sẵn tới
 * mọi nơi cần nó — thì trình sửa, popup xem trước và file PDF khớp nhau theo
 * cấu trúc, không nhờ ai nhớ đồng bộ ba chỗ.
 *
 * Trước đây bản in dùng bảng tiêu đề riêng, ngắn hơn ('KINH NGHIỆM' so với
 * 'KINH NGHIỆM LÀM VIỆC'), nên file PDF tải về không khớp thứ đang nhìn. Một
 * bảng duy nhất ở đây là thứ khiến lỗi đó không quay lại được.
 */

import type { Locale } from './i18n'
import type { CVNodeType } from '../types'

/** Tiêu đề in trong CV — viết hoa, hiển thị trên trang giấy. */
const SECTION_TITLES: Record<Locale, Partial<Record<CVNodeType, string>>> = {
  vi: {
    summary: 'GIỚI THIỆU BẢN THÂN',
    experience: 'KINH NGHIỆM LÀM VIỆC',
    projects: 'DỰ ÁN NỔI BẬT',
    education: 'HỌC VẤN & BẰNG CẤP',
    skills: 'KỸ NĂNG & CÔNG NGHỆ',
    activities: 'HOẠT ĐỘNG & NGOẠI KHÓA',
    certifications: 'CHỨNG CHỈ',
    languages: 'NGOẠI NGỮ',
  },
  en: {
    summary: 'SUMMARY',
    experience: 'WORK EXPERIENCE',
    projects: 'PROJECTS',
    education: 'EDUCATION',
    skills: 'SKILLS & TECHNOLOGIES',
    activities: 'ACTIVITIES',
    certifications: 'CERTIFICATIONS',
    languages: 'LANGUAGES',
  },
}

/** Nhãn khối — dùng cho `aria-label` và cây mục lục bên trái. */
const NODE_LABELS: Record<Locale, Record<CVNodeType, string>> = {
  vi: {
    header: 'Thông tin cá nhân',
    summary: 'Giới thiệu bản thân',
    experience: 'Kinh nghiệm làm việc',
    projects: 'Dự án nổi bật',
    education: 'Học vấn & Bằng cấp',
    skills: 'Kỹ năng & Công nghệ',
    activities: 'Hoạt động & Ngoại khóa',
    certifications: 'Chứng chỉ',
    languages: 'Ngoại ngữ',
    footer: 'Footer',
  },
  en: {
    header: 'Personal information',
    summary: 'Summary',
    experience: 'Work experience',
    projects: 'Projects',
    education: 'Education',
    skills: 'Skills & technologies',
    activities: 'Activities',
    certifications: 'Certifications',
    languages: 'Languages',
    footer: 'Footer',
  },
}

/**
 * CV cũ không khai `language`, và `print.tsx` xưa nay coi mọi giá trị khác
 * `'en'` là tiếng Việt. Giữ đúng quy ước đó để CV cũ không đổi hành vi.
 */
export function cvLocale(language: string | undefined): Locale {
  return language === 'en' ? 'en' : 'vi'
}

export function sectionTitle(type: CVNodeType, language: string | undefined): string {
  return SECTION_TITLES[cvLocale(language)][type] ?? ''
}

export function nodeLabel(type: CVNodeType, language: string | undefined): string {
  return NODE_LABELS[cvLocale(language)][type]
}
