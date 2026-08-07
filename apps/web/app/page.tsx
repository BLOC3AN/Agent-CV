import Link from 'next/link'

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-24">
      <h1 className="text-4xl font-bold tracking-tight">HR-Agent</h1>
      <p className="mt-4 text-lg text-neutral-600">
        Đối chiếu CV của bạn với mô tả công việc, và nhận tư vấn dựa trên kinh
        nghiệm của HR thật — có trích dẫn nguồn.
      </p>
      <div className="mt-8 flex gap-3">
        <Link
          href="/start"
          className="rounded-lg bg-neutral-900 px-5 py-2.5 font-medium text-white hover:bg-neutral-700"
        >
          Bắt đầu
        </Link>
        <Link
          href="/cv"
          className="rounded-lg border border-neutral-300 px-5 py-2.5 font-medium hover:bg-neutral-100"
        >
          CV của tôi
        </Link>
      </div>
    </main>
  )
}
