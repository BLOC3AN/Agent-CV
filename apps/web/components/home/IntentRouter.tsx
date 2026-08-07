import Link from 'next/link'

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
    soon: true,
  },
]

export function IntentRouter() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
      <h1 className="text-4xl font-bold tracking-tight">Tạo một CV thật sự hợp với bạn</h1>
      <p className="mt-4 text-lg text-neutral-600 dark:text-neutral-300">
        Bắt đầu từ chỗ bạn đang đứng. Trợ lý sẽ giúp bạn dựng, soát lại và cải
        thiện CV — dựa trên kinh nghiệm của HR thật, có trích dẫn nguồn.
      </p>

      <h2 className="mt-12 text-sm font-semibold uppercase tracking-wide text-neutral-500">
        Bạn cần giúp gì?
      </h2>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {ENTRIES.map((e) => (
          <EntryCard key={e.href} entry={e} />
        ))}
      </div>

      {/* Nói thẳng trạng thái thay vì để người thử bấm vào ngõ cụt */}
      <p className="mt-10 text-sm text-neutral-500">
        Bản đang phát triển. Đăng nhập chưa mở — mọi thứ đang chạy trên một tài
        khoản thử.
      </p>
    </main>
  )
}

function EntryCard({ entry }: { entry: Entry }) {
  const cls = [
    'flex flex-col rounded-xl border p-5 text-left transition',
    entry.featured
      ? 'border-sky-400 bg-sky-50/60 hover:border-sky-500 dark:border-sky-700 dark:bg-sky-950/20'
      : 'border-neutral-200 hover:border-neutral-400 dark:border-neutral-700 dark:hover:border-neutral-500',
    entry.soon ? 'opacity-70' : '',
  ].join(' ')

  const body = (
    <>
      <span className="font-medium">{entry.title}</span>
      <span className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{entry.desc}</span>
      {entry.soon && (
        <span className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-500">
          Sắp có — hiện tại bạn hãy tải CV lên giúp nhé
        </span>
      )}
    </>
  )

  // Lối vào chưa dựng xong thì KHÔNG phải là link. Một nút dẫn tới 404 còn tệ
  // hơn không có nút: người bấm vào sẽ nghĩ cả hệ thống hỏng (BR-01.3).
  if (entry.soon) {
    return (
      <div className={cls} aria-disabled="true">
        {body}
      </div>
    )
  }
  return (
    <Link href={entry.href} className={cls}>
      {body}
    </Link>
  )
}
