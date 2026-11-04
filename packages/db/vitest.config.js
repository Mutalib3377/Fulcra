import base from '@fulcra/config/vitest';
import { defineConfig, mergeConfig } from 'vitest/config';

export default mergeConfig(
  base,
  defineConfig({
    test: {
      globalSetup: ['./test/global-setup.ts'],
      setupFiles: ['./test/setup-env.ts'],
      // Database tests share one database; run files one at a time.
      fileParallelism: false,
    },
  }),
);
