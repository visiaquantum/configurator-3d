import { defineConfig } from 'vitest/config'

// Unit tests import the sources directly; `tests/package.test.mjs` is the one
// smoke test of the built bundle, as consumers receive it.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/*.test.mjs'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.{ts,tsx}'],
      reporter: ['text-summary', 'html'],
      reportsDirectory: 'coverage',
      // Floors just under today's numbers: coverage may grow, never drop silently.
      thresholds: { statements: 54, branches: 48, functions: 51, lines: 57 },
    },
  },
})
