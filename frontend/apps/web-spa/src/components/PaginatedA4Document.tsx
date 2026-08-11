import React, { useLayoutEffect, useRef, useState } from 'react'
import { A4_PAGE_SETTINGS } from '../lib/a4-settings'

const DEFAULT_PAGE_HEIGHT_PX = 1122

export function pageCountForHeight(height: number, pageHeight: number): number {
  if (!Number.isFinite(height) || height <= 0) return 1
  if (!Number.isFinite(pageHeight) || pageHeight <= 0) return 1
  return Math.max(1, Math.ceil(height / pageHeight))
}

interface PaginatedA4DocumentProps {
  children?: React.ReactNode
  id?: string
  className?: string
  contentClassName?: string
  style?: React.CSSProperties
  measuredHeight?: number
  pageHeight?: number
  pageGroups?: string[][]
  renderPage?: (keys: string[], index: number) => React.ReactNode
}

/**
 * Renders physical A4 pages. Composed CVs provide page groups so each page
 * owns its content and padding; the measured-height path remains available
 * for generic callers that only need visual shells.
 */
export function PaginatedA4Document({
  children,
  id,
  className = '',
  contentClassName = '',
  style,
  measuredHeight,
  pageHeight,
  pageGroups,
  renderPage,
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

  if (pageGroups && renderPage) {
    return (
      <div
        id={id}
        data-testid="a4-document"
        aria-label={`CV ${pageGroups.length} trang`}
        className={`flex w-[210mm] flex-col gap-6 ${className}`}
        style={style}
      >
        {pageGroups.map((keys, index) => (
          <section
            key={`a4-page-${index}`}
            data-testid="a4-page"
            className="a4-page relative shrink-0 border border-slate-200 bg-white shadow-lg"
            style={{
              boxSizing: 'border-box',
              width: A4_PAGE_SETTINGS.width,
              height: A4_PAGE_SETTINGS.height,
              padding: A4_PAGE_SETTINGS.padding,
            }}
          >
            <div className="a4-page-content h-full w-full">
              {renderPage(keys, index)}
            </div>
          </section>
        ))}
      </div>
    )
  }

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
            className="a4-page absolute left-0 top-0 bg-white border border-slate-200 shadow-lg"
            style={{
              top: `calc(${index} * 297mm)`,
              boxSizing: 'border-box',
              width: A4_PAGE_SETTINGS.width,
              height: A4_PAGE_SETTINGS.height,
              padding: A4_PAGE_SETTINGS.padding,
            }}
          />
        ))}
      </div>
      <div ref={contentRef} className={`relative z-10 w-[210mm] ${contentClassName}`}>
        {children}
      </div>
    </div>
  )
}
