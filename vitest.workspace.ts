import { defineWorkspace } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(fileURLToPath(import.meta.url))

const alias = {
  '@hr/schema': path.resolve(root, 'packages/schema/src/index.ts'),
  '@hr/ai': path.resolve(root, 'packages/ai/src/index.ts'),
  '@hr/templates': path.resolve(root, 'packages/templates/src/index.ts'),
  '@hr/db': path.resolve(root, 'packages/db/src/index.ts'),
  '@hr/pdf': path.resolve(root, 'packages/pdf/src/index.ts'),
  '@hr/matching': path.resolve(root, 'packages/matching/src/index.ts'),
  '@hr/kb': path.resolve(root, 'packages/kb/src/index.ts'),
  '@hr/worker/queues': path.resolve(root, 'services/worker/src/queues.ts'),
  '@hr/worker/pdfkit': path.resolve(root, 'services/worker/src/pdfkit-client.ts'),
  '@hr/worker/storage': path.resolve(root, 'services/worker/src/storage.ts'),
  '@hr/worker': path.resolve(root, 'services/worker/src/index.ts'),
  '@': path.resolve(root, 'apps/web'),
}

export default defineWorkspace([
  {
    resolve: { alias },
    esbuild: { jsx: 'automatic' },
    test: {
      name: 'unit',
      // Unit test KHÔNG chạm mạng — mock ở tầng provider (TESTCASES §1.4)
      include: [
        'packages/**/test/**/*.test.ts',
        'packages/**/test/**/*.test.tsx',
        'apps/**/test/**/*.test.ts',
        'apps/**/test/**/*.test.tsx',
        'services/**/test/**/*.test.ts',
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
      include: ['apps/web/test/**/*.ui.test.tsx'],
      environment: 'happy-dom',
      setupFiles: ['apps/web/test/setup.ts'],
      testTimeout: 15_000,
    },
  },
  {
    resolve: { alias },
    esbuild: { jsx: 'automatic' },
    test: {
      name: 'integration',
      // Integration test chạm model server thật (TC-INT-01..05)
      include: [
        'eval/**/*.test.ts',
        'packages/**/test/**/*.int.test.ts',
        'services/**/test/**/*.int.test.ts',
      ],
      environment: 'node',
      testTimeout: 120_000,
      hookTimeout: 60_000,
    },
  },
])
