import { getTestDatabaseUrl } from '@fulcra/db/testing';
import { afterAll } from 'vitest';

// Services use the shared db client; point it at the test database, never the dev one.
process.env.DATABASE_URL = getTestDatabaseUrl();

afterAll(async () => {
  const { getDb } = await import('@fulcra/db');
  await getDb().$client.end();
});
