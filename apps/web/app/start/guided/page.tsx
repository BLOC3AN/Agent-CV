import { GuidedFlow } from '@/components/guided/GuidedFlow'

/** `/start/guided` — làm CV từ đầu, có người dẫn. UC-05. */
export const dynamic = 'force-dynamic'

export default function GuidedPage() {
  return (
    <main className="mx-auto max-w-lg px-6 py-12">
      <h1 className="text-2xl font-semibold">Cùng dựng hồ sơ của bạn</h1>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
        Mình hỏi vài câu, rồi dựng sẵn khung CV cho bạn sửa tiếp.
      </p>
      <div className="mt-8">
        <GuidedFlow />
      </div>
    </main>
  )
}
