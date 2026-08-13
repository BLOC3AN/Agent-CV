import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach } from 'vitest'

/*
 * Ngôn ngữ MẶC ĐỊNH của ứng dụng là tiếng Anh. Phần lớn test UI ở đây có từ
 * thời tiếng Việt là mặc định nên chúng tra phần tử bằng nhãn tiếng Việt.
 *
 * Ghim `vi` ở đây để những test đó tiếp tục kiểm chứng đúng thứ chúng sinh ra
 * để kiểm — hành vi giao diện — thay vì phải dịch lại hơn 100 assertion. Hook
 * này chạy TRƯỚC `beforeEach` của từng file, nên test tiếng Anh chỉ cần đặt
 * lại `hr-locale` trong file của nó là thắng.
 *
 * Giá trị mặc định của chính ứng dụng được ghim riêng ở `i18n.ui.test.tsx`.
 */
beforeEach(() => localStorage.setItem('hr-locale', 'vi'))

afterEach(() => cleanup())
