import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Parallel integration files repeatedly migrate temporary SQLite databases.
// Windows filesystem scheduling can exceed Vitest's five-second default.
const testTimeout = process.platform === 'win32' ? 15_000 : 5_000

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout,
    include: [
      'tests/unit/**/*.test.ts',
      'tests/unit/**/*.test.tsx',
      'tests/integration/**/*.test.ts',
      'tests/integration/**/*.test.tsx'
    ]
  },
  resolve: {
    alias: {
      '@main': resolve(__dirname, 'src/main'),
      '@preload': resolve(__dirname, 'src/preload'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  }
})
