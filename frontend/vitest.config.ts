import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(fileURLToPath(import.meta.url))

export const alias = {
  '@hr/schema': path.resolve(root, 'packages/schema/src/index.ts'),
  '@hr/ai': path.resolve(root, 'packages/ai/src/index.ts'),
  '@hr/templates': path.resolve(root, 'packages/templates/src/index.ts'),
  '@hr/db': path.resolve(root, 'packages/db/src/index.ts'),
  '@hr/matching': path.resolve(root, 'packages/matching/src/index.ts'),
  '@hr/kb': path.resolve(root, 'packages/kb/src/index.ts'),
}

export default defineConfig({
  resolve: { alias },
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
  },
})
