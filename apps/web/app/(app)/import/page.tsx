import { UploadBox } from '@/components/import/UploadBox'
import { parseIntent } from '@/lib/intent'

/**
 * `/import` — tải CV lên (UC-21).
 *
 * Bước đầu tiên của luồng F1. Trang này cố tình đơn giản: người dùng đang lo
 * lắng về CV của mình, không phải đang khám phá tính năng.
 */

export const dynamic = 'force-dynamic'

/** Lời dẫn nói lại đúng thứ người dùng vừa chọn ở Home — họ nhận ra mình. */
const LEAD: Record<string, string> = {
  diagnose:
    'Sau khi đọc xong, hệ thống sẽ chỉ ra CV của bạn đang yếu ở đâu và ba thứ nên sửa trước.',
  job: 'Đọc xong CV, bạn dán tin tuyển dụng vào để xem mình còn thiếu gì so với yêu cầu.',
  improve: 'Hệ thống sẽ đọc CV và dựng thành hồ sơ có cấu trúc để bạn sửa tiếp.',
}

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const intent = parseIntent(typeof sp['intent'] === 'string' ? sp['intent'] : null)

  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Tải CV của bạn lên</h1>
      <p className="mt-2 text-ink-muted ">
        {intent ? LEAD[intent] : LEAD['improve']} Bạn sẽ được xem lại từng mục
        trước khi dùng — máy đọc tự động nên có thể sai.
      </p>

      <UploadBox intent={intent} />

      <section className="mt-10 rounded-lg border border-border p-4 text-sm text-ink-muted  ">
        <h2 className="mb-2 font-medium text-ink ">
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
