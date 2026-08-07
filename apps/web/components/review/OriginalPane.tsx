'use client'

import { useEffect, useMemo, useState } from 'react'

/**
 * Cột trái màn hình rà soát — ảnh trang PDF gốc kèm vùng tô sáng (UC-22 bước 2).
 *
 * Mục đích nghiệp vụ: user đối chiếu được NGAY, không phải nhớ bản gốc trong
 * đầu. Không có cột này thì "Đúng rồi" chỉ là một cú bấm cho xong.
 */

export interface Block {
  page: number
  bbox: [number, number, number, number]
  text: string
}

export interface PagesData {
  expired: boolean
  dpi?: number
  scale?: number
  pages: { index: number; png: string }[]
  blocks: Block[]
}

/** Bỏ dấu + hạ chữ thường để so khớp không phụ thuộc cách gõ. */
function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Tìm khối text chứa giá trị đang xét.
 *
 * So khớp theo NỘI DUNG chứ không theo toạ độ vì Profile không giữ vị trí gốc:
 * model trả về dữ liệu đã chuẩn hoá, mọi liên hệ với trang giấy đã mất. Khớp
 * chuỗi là cách duy nhất còn lại để nối hai bên.
 */
export function findBlocks(blocks: Block[], values: string[]): Block[] {
  const needles = values.map(norm).filter((v) => v.length >= 4)
  if (needles.length === 0) return []

  return blocks.filter((b) => {
    const hay = norm(b.text)
    return needles.some((n) => hay.includes(n) || (n.length > 25 && n.includes(hay) && hay.length > 15))
  })
}

interface Props {
  jobId: string
  /** Giá trị của mục đang được xem — dùng để tìm vùng tô sáng */
  highlightValues: string[]
}

export function OriginalPane({ jobId, highlightValues }: Props) {
  const [data, setData] = useState<PagesData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  /** Kích thước thật của ảnh — cần để quy toạ độ khối ra phần trăm. */
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/imports/${jobId}/pages`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: PagesData) => !cancelled && setData(d))
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [jobId])

  const hits = useMemo(
    () => (data ? findBlocks(data.blocks, highlightValues) : []),
    [data, highlightValues],
  )

  // Nhảy tới trang chứa vùng đang xét — user không phải tự tìm
  useEffect(() => {
    if (hits.length > 0 && hits[0]!.page !== page) setPage(hits[0]!.page)
    // Cố ý bỏ `page`: chỉ nhảy khi vùng tô sáng ĐỔI, không nhảy lại khi user
    // tự lật trang để xem chỗ khác.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hits])

  if (error) {
    return (
      <Frame>
        <p className="text-sm text-neutral-500">
          Chưa hiện được bản gốc ({error}). Bạn vẫn rà soát bình thường ở cột bên phải.
        </p>
      </Frame>
    )
  }

  if (!data) {
    return (
      <Frame>
        <div className="h-96 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800" />
      </Frame>
    )
  }

  if (data.expired || data.pages.length === 0) {
    return (
      <Frame>
        <p className="text-sm text-neutral-500">
          File gốc đã được xoá sau 48 giờ theo chính sách bảo mật. Bạn vẫn rà soát và
          sửa được nội dung ở cột bên phải.
        </p>
      </Frame>
    )
  }

  const current = data.pages[Math.min(page, data.pages.length - 1)]!
  const scale = data.scale ?? 1
  const onPage = hits.filter((h) => h.page === current.index)

  return (
    <Frame>
      <div className="relative block w-full">
        {/* Ảnh render sẵn phía server; không dùng next/image vì đây là data URI
            động, tối ưu hoá của Next không áp dụng được */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`data:image/png;base64,${current.png}`}
          alt={`Trang ${current.index + 1} của CV gốc`}
          onLoad={(e) => {
            const img = e.currentTarget
            setNatural({ w: img.naturalWidth, h: img.naturalHeight })
          }}
          className="block h-auto w-full rounded border border-neutral-200 dark:border-neutral-700"
        />
        {/* Vị trí tính bằng PHẦN TRĂM của kích thước ảnh gốc, không phải px:
            ảnh hiển thị co giãn theo bề ngang cột, nên px của ảnh gốc không
            còn khớp với px trên màn hình. Phần trăm thì đúng ở mọi cỡ. */}
        {natural &&
          onPage.map((b, i) => (
            <span
              key={`${b.page}-${i}`}
              aria-hidden
              className="pointer-events-none absolute rounded-sm bg-amber-300/35 ring-2 ring-amber-500/70"
              style={{
                left: `${((b.bbox[0] * scale) / natural.w) * 100}%`,
                top: `${((b.bbox[1] * scale) / natural.h) * 100}%`,
                width: `${(((b.bbox[2] - b.bbox[0]) * scale) / natural.w) * 100}%`,
                height: `${(((b.bbox[3] - b.bbox[1]) * scale) / natural.h) * 100}%`,
              }}
            />
          ))}
      </div>

      {data.pages.length > 1 && (
        <div className="mt-3 flex items-center justify-center gap-3 text-sm">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="rounded px-2 py-1 disabled:opacity-30"
            aria-label="Trang trước"
          >
            ◀
          </button>
          <span className="tabular-nums text-neutral-600 dark:text-neutral-400">
            Trang {current.index + 1}/{data.pages.length}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(data.pages.length - 1, p + 1))}
            disabled={page >= data.pages.length - 1}
            className="rounded px-2 py-1 disabled:opacity-30"
            aria-label="Trang sau"
          >
            ▶
          </button>
        </div>
      )}
    </Frame>
  )
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <section
      aria-label="Bản gốc"
      className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900"
    >
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Bản gốc
      </h2>
      {children}
    </section>
  )
}
