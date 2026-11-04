import base from '@fulcra/config/vitest';
import { defineConfig, mergeConfig } from 'vitest/config';

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
