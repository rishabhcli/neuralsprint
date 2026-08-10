import { defineConfig } from 'vitest/config';

export default defineConfig({
  cacheDir: '.dev/cache/vitest',
  test: {
    coverage: {
      // Every domain ownership area that has code. `src/ui` and `src/main.tsx` are
      // covered by the Playwright layer instead, which exercises them in a real browser.
      include: [
        'src/config/**/*.ts',
        'src/findings/**/*.ts',
        'src/pdf/**/*.ts',
        'src/sanitizer/**/*.ts',
        'src/verifier/**/*.ts',
      ],
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
