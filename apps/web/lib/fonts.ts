import localFont from 'next/font/local'

/**
 * Be Vietnam Pro — nhúng cục bộ, KHÔNG gọi Google Fonts lúc chạy.
 *
 * Trang /print render trong Playwright ở worker; nếu font đến từ mạng ngoài
 * thì môi trường không có internet sẽ in ra font thay thế, và lỗi chỉ lộ ở
 * file PDF cuối cùng chứ không lộ trên màn hình dev.
 *
 * Dùng `variable` chứ không `className`: `packages/templates/src/styles.css`
 * cần tham chiếu font qua biến CSS, vì nó là gói dùng chung không biết gì về
 * next/font. Đặt `className` thì next/font sinh tên họ băm mà CSS kia không
 * đoán được.
 *
 * Chỉ hai weight (400, 600) — thang chữ ở spec §3.2 không dùng weight nào khác,
 * và mỗi weight thêm vào là một file nữa phải tải trước khi trang hiện chữ.
 */
export const beVietnamPro = localFont({
  src: [
    { path: '../app/fonts/BeVietnamPro-Regular.woff2', weight: '400', style: 'normal' },
    { path: '../app/fonts/BeVietnamPro-SemiBold.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-be-vietnam',
  display: 'swap',
  fallback: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
})
