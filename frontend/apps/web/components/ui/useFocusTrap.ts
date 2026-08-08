'use client'

import { useEffect, useRef } from 'react'

/**
 * Bẫy focus cho lớp phủ — dùng chung cho Dialog và Sheet.
 *
 * ── Vì sao tự viết thay vì thêm thư viện ──
 * Spec D6 chốt không thêm dependency UI. Bốn hành vi dưới đây là toàn bộ thứ
 * hai component cần, và chúng đo được bằng test bàn phím thật:
 *   1. Escape đóng
 *   2. Focus vào trong khi mở
 *   3. Tab vòng lại, không trôi ra nền
 *   4. Trả focus về phần tử đã mở khi đóng
 *
 * Thiếu (4) là lỗi tệ nhất: người dùng bàn phím đóng modal xong thì focus về
 * đầu trang, phải Tab lại từ đầu để tìm chỗ cũ.
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function useFocusTrap(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement | null>(null)
  const restoreTo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    const node = ref.current
    if (!node) return

    restoreTo.current = document.activeElement as HTMLElement | null

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // Lọc hiển thị bằng `checkVisibility`, không dùng `offsetParent`:
    // `offsetParent` chỉ bắt được `display:none` và dựa vào layout engine —
    // nó cũng KHÔNG bắt `visibility:hidden` (phần tử vẫn chiếm layout).
    // `checkVisibility({visibilityProperty: true})` đọc computed style trực
    // tiếp nên bắt được cả hai, và chạy đúng trong happy-dom (môi trường
    // test) vì không cần layout thật. Fallback `true` khi API không tồn tại
    // (trình duyệt cũ) để không vô tình loại sạch phần tử.
    const visible = (el: HTMLElement): boolean =>
      typeof el.checkVisibility === 'function'
        ? el.checkVisibility({ visibilityProperty: true })
        : true

    const items = (): HTMLElement[] =>
      Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => visible(el) || el === document.activeElement,
      )

    // Focus phần tử đầu tiên; nếu lớp phủ chưa có gì focus được thì focus
    // chính nó (nó có tabIndex={-1}) để phím Escape vẫn tới nơi.
    const first = items()[0]
    ;(first ?? node).focus()

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab') return

      const list = items()
      if (list.length === 0) {
        e.preventDefault()
        return
      }
      const firstEl = list[0]!
      const lastEl = list[list.length - 1]!

      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault()
        firstEl.focus()
      } else if (!node.contains(document.activeElement)) {
        e.preventDefault()
        firstEl.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = prevOverflow
      restoreTo.current?.focus()
    }
  }, [open, onClose])

  return ref
}
