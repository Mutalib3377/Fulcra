import { getTestDatabaseUrl, prepareTestDatabase } from '../src/testing';

/** Vitest global setup: point DATABASE_URL at a migrated test database. */
export default async function setup() {
  const url = getTestDatabaseUrl();
  await prepareTestDatabase(url);
  process.env.DATABASE_URL = url;
}
