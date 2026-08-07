import Link from 'next/link'

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-24">
      <h1 className="text-4xl font-bold tracking-tight">HR-Agent</h1>
      <p className="mt-4 text-lg text-neutral-600">
        Đối chiếu CV của bạn với mô tả công việc, và nhận tư vấn dựa trên kinh
        nghiệm của HR thật — có trích dẫn nguồn.
      </p>
      {/* Chỉ để lại lối đi CÓ THẬT. Nút dẫn tới route chưa tồn tại còn tệ hơn
          không có nút: người thử bấm vào và gặp 404 sẽ nghĩ hệ thống hỏng. */}
      <div className="mt-8">
        <Link
          href="/import"
          className="inline-block rounded-lg bg-neutral-900 px-5 py-2.5 font-medium text-white hover:bg-neutral-700"
        >
          Tải CV lên
        </Link>
      </div>
      {/* Nói thẳng trạng thái thay vì để người thử bấm vào ngõ cụt */}
      <p className="mt-10 text-sm text-neutral-500">
        Bản đang phát triển: luồng tải CV lên và rà soát đã chạy được. Đăng nhập,
        đối chiếu JD và trợ lý AI chưa mở.
      </p>
    </main>
  )
}
