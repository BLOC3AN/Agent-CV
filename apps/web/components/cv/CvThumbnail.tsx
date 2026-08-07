'use client'

import { CvFrame, DEFAULT_THEME, type Theme } from '@hr/templates'
import type { Profile } from '@hr/schema'

/**
 * Bản CV thu nhỏ — FRONTEND §9.3, nơi dùng thứ ba của cùng một component.
 *
 * ── Vì sao thu nhỏ bằng CSS chứ không chụp ảnh ──
 * Cách còn lại là để Playwright chụp /print rồi lưu PNG. Nó kéo theo: một hàng
 * đợi job, một chỗ lưu file, và một bài toán vô hiệu hoá cache mỗi lần người
 * dùng sửa một chữ. Ảnh cũ hiện ở Home sau khi vừa sửa xong là lỗi khó chịu
 * mà lại rất dễ xảy ra.
 *
 * Thu nhỏ bằng `transform: scale` thì bản thu nhỏ CHÍNH LÀ bản thật, luôn
 * đúng, và tốn 0 tài nguyên server.
 *
 * ── Đánh đổi đã biết ──
 * `packages/templates/src/field.tsx` đánh dấu 'use client' (React Context
 * không dùng được trong Server Component), nên cả cây template là client.
 * Đặt thumbnail ở Home nghĩa là gửi mã template và JSON hồ sơ xuống trình
 * duyệt. Chấp nhận: đây là hồ sơ của chính người đang xem, và con số đo được
 * nằm trong mức chịu được cho một trang.
 *
 * `aria-hidden`: đây là hình minh hoạ. Nội dung CV đã có ở chỗ khác trên trang
 * dưới dạng chữ đọc được; để trình đọc màn hình đọc lại toàn bộ CV ở cỡ chữ
 * 3px là tra tấn người dùng.
 */

/** Chiều rộng khổ A4 ở 96dpi — mốc để tính tỉ lệ thu nhỏ. */
const A4_WIDTH_PX = 794

export function CvThumbnail({
  profile,
  templateId = 'elegant',
  theme,
  width = 160,
  className = '',
}: {
  profile: Profile
  templateId?: string
  theme?: Partial<Theme>
  width?: number
  className?: string
}) {
  const scale = width / A4_WIDTH_PX

  return (
    <div
      aria-hidden="true"
      style={{ width, height: Math.round(width * 1.414) }}
      className={`overflow-hidden rounded-sm border border-border bg-white ${className}`}
    >
      <div
        style={{
          width: A4_WIDTH_PX,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      >
        <CvFrame
          profile={profile}
          templateId={templateId}
          variant="thumbnail"
          theme={{ ...DEFAULT_THEME, ...theme }}
        />
      </div>
    </div>
  )
}
