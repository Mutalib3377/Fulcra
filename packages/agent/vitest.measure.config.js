import { defineConfig } from 'vitest/config';
// Loads the root .env (ANTHROPIC_API_KEY) like the normal tests.
import '@fulcra/config/vitest';

// `pnpm --filter @fulcra/agent measure`: real conversations against the real Claude API
// (costs a little money; needs ANTHROPIC_API_KEY). Not part of `pnpm test`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['measure/**/*.measure.ts'],
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup-env.ts'],
    fileParallelism: false,
    testTimeout: 600_000,
    silent: false,
    hookTimeout: 120_000,
  },
});
