import React, { useLayoutEffect, useRef, useState } from 'react'

const DEFAULT_PAGE_HEIGHT_PX = 1122

export function pageCountForHeight(height: number, pageHeight: number): number {
  if (!Number.isFinite(height) || height <= 0) return 1
  if (!Number.isFinite(pageHeight) || pageHeight <= 0) return 1
  return Math.max(1, Math.ceil(height / pageHeight))
}

interface PaginatedA4DocumentProps {
  children: React.ReactNode
  id?: string
  className?: string
  contentClassName?: string
  style?: React.CSSProperties
  measuredHeight?: number
  pageHeight?: number
}

/**
 * A4 background shells are kept separate from the flowing CV content. This
 * lets long CVs keep their natural HTML flow while the editor still shows the
 * physical A4 boundaries that the browser will use when printing.
 */
export function PaginatedA4Document({
  children,
  id,
  className = '',
  contentClassName = '',
  style,
  measuredHeight,
  pageHeight,
}: PaginatedA4DocumentProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const [pageCount, setPageCount] = useState(() =>
    pageCountForHeight(measuredHeight ?? 1, pageHeight ?? DEFAULT_PAGE_HEIGHT_PX),
  )

  useLayoutEffect(() => {
    if (measuredHeight !== undefined) {
      setPageCount(pageCountForHeight(measuredHeight, pageHeight ?? DEFAULT_PAGE_HEIGHT_PX))
      return
    }

    const content = contentRef.current
    if (!content) return

    const updatePageCount = () => {
      const measuredPageHeight = shellRef.current?.getBoundingClientRect().height ?? DEFAULT_PAGE_HEIGHT_PX
      setPageCount(pageCountForHeight(content.scrollHeight, measuredPageHeight))
    }

    updatePageCount()
    const observer = new ResizeObserver(updatePageCount)
    observer.observe(content)
    return () => observer.disconnect()
  }, [measuredHeight, pageHeight, children])

  return (
    <div
      id={id}
      data-testid="a4-document"
      aria-label={`CV ${pageCount} trang`}
      className={`relative w-[210mm] ${className}`}
      style={style}
    >
      <div className="pointer-events-none absolute inset-0 z-0" aria-hidden="true">
        {Array.from({ length: pageCount }, (_, index) => (
          <div
            key={index}
            ref={index === 0 ? shellRef : undefined}
            data-testid="a4-page"
            className="absolute left-0 top-0 w-[210mm] h-[297mm] bg-white border border-slate-200 shadow-lg"
            style={{ top: `calc(${index} * 297mm)` }}
          />
        ))}
      </div>
      <div ref={contentRef} className={`relative z-10 w-[210mm] ${contentClassName}`}>
        {children}
      </div>
    </div>
  )
}
