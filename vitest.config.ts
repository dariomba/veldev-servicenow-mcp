import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only run TypeScript sources. The compiled output in build/ contains
    // duplicate .test.js files whose .json fixtures are not copied by tsc,
    // so they must never be collected as tests.
    include: ['src/**/*.test.ts'],
    exclude: ['build/**', 'node_modules/**'],
  },
});
