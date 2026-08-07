import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(fileURLToPath(import.meta.url))

export const alias = {
  '@hr/schema': path.resolve(root, 'packages/schema/src/index.ts'),
  '@hr/ai': path.resolve(root, 'packages/ai/src/index.ts'),
  '@hr/templates': path.resolve(root, 'packages/templates/src/index.ts'),
  '@hr/db': path.resolve(root, 'packages/db/src/index.ts'),
  '@hr/pdf': path.resolve(root, 'packages/pdf/src/index.ts'),
  '@hr/worker/queues': path.resolve(root, 'services/worker/src/queues.ts'),
  '@hr/worker/storage': path.resolve(root, 'services/worker/src/storage.ts'),
  '@hr/worker': path.resolve(root, 'services/worker/src/index.ts'),
}

export default defineConfig({
  resolve: { alias },
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
  },
})
