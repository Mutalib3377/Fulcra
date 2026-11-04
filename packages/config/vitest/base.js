// Shared Vitest settings. Packages call defineConfig(mergeConfig(base, {...})) if they need more.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'lib/**/*.test.ts', 'test/**/*.test.ts'],
    passWithNoTests: true,
  },
});
