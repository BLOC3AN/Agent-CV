'use client'

import { useEffect, useState } from 'react'

/**
 * Banner suy giảm — UC-71, TDD §5.5, X-2.
 *
 * ── Vì sao phải có ──
 * Nguyên tắc A7 của hệ thống là "suy giảm, đừng sập": model server chết thì
 * sửa CV, đổi mẫu và xuất PDF vẫn chạy. Nhưng nếu KHÔNG NÓI RA, người dùng chỉ
 * thấy nút "Hỏi trợ lý" quay mãi rồi báo lỗi, và kết luận cả sản phẩm hỏng.
 *
 * Banner này nói hai thứ, theo đúng thứ tự đó: **cái gì vẫn dùng được**, rồi
 * mới tới cái gì đang tạm ngừng. Nói cái mất trước làm người ta bỏ đi trước khi
 * đọc tới phần còn dùng được.
 */

interface Health {
  degraded: boolean
  db: boolean
  features: Record<string, boolean>
}

/** Nhãn tính năng cho người đọc — không phải tên biến. */
const LABEL: Record<string, string> = {
  importCv: 'đọc CV tự động',
  chat: 'trợ lý AI',
  matchSemantic: 'đối chiếu theo ngữ nghĩa',
  matchKeyword: 'đối chiếu theo từ khoá',
  editProfile: 'sửa hồ sơ',
  changeTemplate: 'đổi mẫu CV',
  exportPdf: 'xuất PDF',
}

/** Kiểm lại mỗi 30 giây — đủ nhanh để banner tự tắt khi model sống lại. */
const POLL_MS = 30_000

export function DegradeBanner() {
  const [health, setHealth] = useState<Health | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let alive = true
    const check = async () => {
      try {
        const res = await fetch('/api/health')
        const data = (await res.json()) as Health
        if (alive) setHealth(data)
      } catch {
        // Không gọi được /api/health thì im lặng: banner báo "mất mạng" trong
        // khi người dùng đang gõ CV chỉ gây hoang mang, mà họ vẫn gõ tiếp được.
      }
    }
    void check()
    const t = setInterval(() => void check(), POLL_MS)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  if (!health?.degraded || dismissed) return null

  const off = Object.entries(health.features)
    .filter(([, ok]) => !ok)
    .map(([k]) => LABEL[k] ?? k)
  const on = Object.entries(health.features)
    .filter(([, ok]) => ok)
    .map(([k]) => LABEL[k] ?? k)

  return (
    <div
      role="status"
      aria-live="polite"
      className="border-b border-amber-300 bg-amber-50 px-6 py-2 text-sm dark:border-amber-800 dark:bg-amber-950/40"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-baseline gap-x-2 gap-y-1">
        <span aria-hidden>⚠</span>
        {/* Cái CÒN DÙNG ĐƯỢC nói trước — nói cái mất trước làm người ta bỏ đi */}
        <span>
          Máy chủ AI đang không phản hồi. Bạn vẫn <strong>{on.slice(0, 3).join(', ')}</strong> bình
          thường.
        </span>
        {off.length > 0 && <span className="text-amber-800 dark:text-amber-300">Tạm ngừng: {off.join(', ')}.</span>}
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-xs underline"
          aria-label="Ẩn thông báo"
        >
          Ẩn
        </button>
      </div>
    </div>
  )
}
