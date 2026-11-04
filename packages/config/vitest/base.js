// Shared Vitest settings. Packages call defineConfig(mergeConfig(base, {...})) if they need more.
import path from 'node:path';
import process from 'node:process';
import { defineConfig } from 'vitest/config';

// Tests read the same root .env as the apps. Real environment variables (CI) win.
try {
  process.loadEnvFile(path.join(import.meta.dirname, '../../../.env'));
} catch {
  // No .env file (CI): use the real environment.
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'lib/**/*.test.ts', 'test/**/*.test.ts'],
    passWithNoTests: true,
  },
});
