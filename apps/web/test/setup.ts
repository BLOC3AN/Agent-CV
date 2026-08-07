import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

/**
 * Thiết lập chung cho test giao diện.
 *
 * `cleanup` sau mỗi test là bắt buộc: happy-dom giữ nguyên document giữa các
 * test, nên component của test trước còn nằm đó và `getByText` sẽ tìm thấy
 * nhiều hơn một kết quả — lỗi rất khó hiểu nếu không biết nguyên nhân.
 */
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
