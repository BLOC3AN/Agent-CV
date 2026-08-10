import { defineWorkspace } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(fileURLToPath(import.meta.url))

const alias = {
  '@hr/schema': path.resolve(root, 'packages/schema/src/index.ts'),
  '@hr/kb': path.resolve(root, 'packages/kb/src/index.ts'),
}

// Vite mặc định chỉ phục vụ file bên trong root của chính nó (ở đây là
// `frontend/`) — file `../backend/**` (test lẫn module nó import) bị chặn
// với lỗi "Does the file exist?" dù file có thật, vì nằm ngoài fs.allow mặc
// định. 'unit' cũng include `../backend/db/**/*.test.ts` nên phải mở fs.allow
// lên tới root của cả
// monorepo (thư mục cha của `frontend/`), không chỉ riêng `frontend/`.
const fsAllow = [root, path.resolve(root, '..')]

export default defineWorkspace([
  {
    resolve: { alias },
    esbuild: { jsx: 'automatic' },
    server: { fs: { allow: fsAllow } },
    test: {
      name: 'unit',
      // Unit test KHÔNG chạm mạng — mock ở tầng provider (TESTCASES §1.4)
      include: [
        'packages/**/test/**/*.test.ts',
        'packages/**/test/**/*.test.tsx',
        'apps/**/test/**/*.test.ts',
        'apps/**/test/**/*.test.tsx',
        // backend/db/ có các hàm kiểm tra thuần, không chạm DB/mạng, nên hợp lệ
        // ở project 'unit' này.
        '../backend/db/**/*.test.ts',
      ],
      // Loại test GIAO DIỆN: chúng khớp `*.test.tsx` nên sẽ chạy CẢ ở đây,
      // trong môi trường `node` không có DOM, và đỏ vì `document is not defined`.
      exclude: ['**/*.int.test.ts', '**/*.ui.test.tsx'],
      environment: 'node',
      testTimeout: 15_000,
    },
  },
  {
    // Test GIAO DIỆN — cần DOM. Tách project riêng vì `environment: 'happy-dom'`
    // làm mọi test khác chậm hơn mà không được lợi gì.
    resolve: { alias },
    esbuild: { jsx: 'automatic' },
    test: {
      name: 'ui',
      include: ['apps/*/test/**/*.ui.test.tsx'],
      environment: 'happy-dom',
      setupFiles: ['apps/web-spa/test/setup.ts'],
      testTimeout: 15_000,
    },
  },
  {
    resolve: { alias },
    esbuild: { jsx: 'automatic' },
    server: { fs: { allow: fsAllow } },
    test: {
      name: 'integration',
      // Integration test chạm model server thật (TC-INT-01..05)
      include: [
        'packages/**/test/**/*.int.test.ts',
        // Lớp E2E chạy trình duyệt thật — cùng nhóm với test tích hợp vì cả hai
        // đều cần hạ tầng sống, và một bộ chạy test là đủ cho cả dự án.
        'apps/**/test/**/*.int.test.ts',
      ],
      environment: 'node',
      testTimeout: 120_000,
      hookTimeout: 60_000,
    },
  },
])
