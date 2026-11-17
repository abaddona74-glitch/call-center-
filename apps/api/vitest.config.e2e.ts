import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // e2e files share one Postgres database (reset per file), so they must not run concurrently
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
