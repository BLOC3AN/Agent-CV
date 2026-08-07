import Link from 'next/link'
import { Card } from '@/components/ui'

/**
 * Home lần đầu — bộ định tuyến ý định. UC-01, PRODUCT §4.
 *
 * ── Vì sao không phải một nút "Tải CV lên" ──
 * Nút đó giả định người dùng (a) đã có CV, (b) biết mình cần sửa gì, (c) hiểu
 * tải lên là bước đầu của một quy trình dài. Cả ba đều sai với sinh viên và
 * người mới ra trường — đúng nhóm sản phẩm này phục vụ.
 *
 * Bốn lối vào là bốn CỬA vào cùng một `Profile`, không phải bốn hệ thống
 * (BR-01.1). Người vào bằng cửa "làm từ đầu" rồi muốn đối chiếu tin tuyển dụng
 * phải dùng được ngay.
 */

interface Entry {
  href: string
  /** Câu NGƯỜI DÙNG tự nói về mình — không phải tên tính năng (BR-01.2) */
  title: string
  desc: string
  /** Lối vào nổi bật: nhóm đông nhất và bị bỏ rơi nặng nhất */
  featured?: boolean
  /** Chưa dựng xong — hiện nhưng nói thẳng, không dẫn tới 404 (BR-01.3) */
  soon?: boolean
}

export const ENTRIES: Entry[] = [
  {
    href: '/import?intent=improve',
    title: 'Tôi đã có CV',
    desc: 'Tải lên rồi sửa cho tốt hơn',
  },
  {
    href: '/import?intent=diagnose',
    title: 'Tôi không biết CV mình dở ở đâu',
    desc: 'Nhận một bản chẩn đoán trước khi sửa',
    featured: true,
  },
  {
    href: '/import?intent=job',
    title: 'Tôi có việc muốn ứng tuyển',
    desc: 'Chỉnh CV cho khớp tin tuyển dụng đó',
  },
  {
    href: '/start/guided',
    title: 'Tôi chưa có CV nào',
    desc: 'Làm từ đầu, có người dẫn từng bước',
  },
]

export function IntentRouter() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
      <h1 className="text-4xl font-bold tracking-tight">Tạo một CV thật sự hợp với bạn</h1>
      <p className="mt-4 text-lg text-ink-muted">
        Bắt đầu từ chỗ bạn đang đứng. Trợ lý sẽ giúp bạn dựng, soát lại và cải
        thiện CV — dựa trên kinh nghiệm của HR thật, có trích dẫn nguồn.
      </p>

      <h2 className="mt-12 text-sm font-semibold uppercase tracking-wide text-ink-muted">
        Bạn cần giúp gì?
      </h2>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {ENTRIES.map((e) => (
          <EntryCard key={e.href} entry={e} />
        ))}
      </div>

      {/* Nói thẳng trạng thái thay vì để người thử bấm vào ngõ cụt */}
      <p className="mt-10 text-sm text-ink-muted">
        Bản đang phát triển. Đăng nhập chưa mở — mọi thứ đang chạy trên một tài
        khoản thử.
      </p>
    </main>
  )
}

function EntryCard({ entry }: { entry: Entry }) {
  // Featured mượn màu thương hiệu để nổi bật lối vào cho nhóm hoang mang nhất
  // — đây vẫn là brand emphasis, không phải chữ ký AI (Card variant="ai" dành
  // riêng cho nội dung do máy đề xuất, spec §5.1).
  const cardContent = (
    <Card
      variant="raised"
      className={[
        'h-full transition-colors',
        entry.featured ? 'border-brand bg-brand-subtle hover:border-brand-hover' : 'hover:border-brand',
        entry.soon ? 'opacity-70' : '',
      ].join(' ')}
    >
      <p className="text-[15px] font-semibold text-ink">{entry.title}</p>
      <p className="mt-1 text-[13px] text-ink-muted">{entry.desc}</p>
      {entry.soon && (
        <p className="mt-2 text-[13px] font-medium text-warn">
          Sắp có — hiện tại bạn hãy tải CV lên giúp nhé
        </p>
      )}
    </Card>
  )

  // Lối vào chưa dựng xong thì KHÔNG phải là link. Một nút dẫn tới 404 còn tệ
  // hơn không có nút: người bấm vào sẽ nghĩ cả hệ thống hỏng (BR-01.3).
  if (entry.soon) {
    return <div aria-disabled="true">{cardContent}</div>
  }
  return (
    <Link
      href={entry.href}
      className="block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      {cardContent}
    </Link>
  )
}
