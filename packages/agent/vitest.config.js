import base from '@fulcra/config/vitest';
import { defineConfig, mergeConfig } from 'vitest/config';

// Scenario tests run real Core services against the test database, with a scripted fake Claude.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      globalSetup: ['./test/global-setup.ts'],
      setupFiles: ['./test/setup-env.ts'],
      fileParallelism: false,
    },
  }),
);
