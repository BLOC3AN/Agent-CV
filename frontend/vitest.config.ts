import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(fileURLToPath(import.meta.url))

export const alias = {
  '@hr/schema': path.resolve(root, 'packages/schema/src/index.ts'),
  '@hr/kb': path.resolve(root, 'packages/kb/src/index.ts'),
}

export default defineConfig({
  resolve: { alias },
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
  },
})
