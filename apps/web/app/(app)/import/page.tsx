import { UploadBox } from '@/components/import/UploadBox'

/**
 * `/import` — tải CV lên (UC-21).
 *
 * Bước đầu tiên của luồng F1. Trang này cố tình đơn giản: người dùng đang lo
 * lắng về CV của mình, không phải đang khám phá tính năng.
 */

export const dynamic = 'force-dynamic'

export default function ImportPage() {
  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Tải CV của bạn lên</h1>
      <p className="mt-2 text-neutral-600 dark:text-neutral-400">
        Hệ thống sẽ đọc CV và dựng thành hồ sơ có cấu trúc. Bạn sẽ được xem lại
        từng mục trước khi dùng — máy đọc tự động nên có thể sai.
      </p>

      <UploadBox />

      <section className="mt-10 rounded-lg border border-neutral-200 p-4 text-sm text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
        <h2 className="mb-2 font-medium text-neutral-900 dark:text-neutral-100">
          Về dữ liệu của bạn
        </h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Tên, email, số điện thoại được <strong>che trước khi</strong> gửi cho AI.</li>
          <li>File gốc bị xoá sau 48 giờ; chỉ giữ lại hồ sơ đã chuẩn hoá.</li>
          <li>Toàn bộ xử lý chạy trên máy chủ riêng, không gửi ra dịch vụ ngoài.</li>
        </ul>
      </section>
    </main>
  )
}
