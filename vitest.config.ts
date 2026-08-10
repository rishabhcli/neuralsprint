import { defineConfig } from 'vitest/config';

export default defineConfig({
  cacheDir: '.dev/cache/vitest',
  test: {
    coverage: {
      include: ['src/config/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      thresholds: {
        branches: 90,
        functions: 90,
        lines: 90,
        statements: 90,
      },
    },
    environment: 'node',
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
    include: ['tests/**/*.{test,spec}.ts'],
    passWithNoTests: false,
    reporters: ['default'],
    sequence: {
      concurrent: false,
    },
    testTimeout: 10_000,
  },
});
