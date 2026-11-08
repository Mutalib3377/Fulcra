import { randomBytes } from 'node:crypto';
import { getTestDatabaseUrl } from '@fulcra/db/testing';
import { afterAll } from 'vitest';

// Services use the shared db client; point it at the test database, never the dev one.
process.env.DATABASE_URL = getTestDatabaseUrl();
// Shop keys are encrypted; tests use a throwaway key when none is set.
process.env.ENCRYPTION_KEY ||= randomBytes(32).toString('base64');

afterAll(async () => {
  const { getDb } = await import('@fulcra/db');
  await getDb().$client.end();
});
