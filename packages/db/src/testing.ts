/**
 * Test helpers: a separate, freshly migrated database for automated tests.
 * Used from Vitest global setup in packages whose tests touch the database.
 */
import path from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const MIGRATIONS_FOLDER = path.join(import.meta.dirname, '../migrations');

export function getTestDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.DATABASE_URL_TEST;
  if (!url) {
    throw new Error('DATABASE_URL_TEST is not set. See .env.example and run `pnpm db:up`.');
  }
  const name = new URL(url).pathname.slice(1);
  if (!/test/.test(name)) {
    throw new Error(
      `Refusing to run tests against "${name}": the test database name must contain "test".`,
    );
  }
  return url;
}

/**
 * Creates the test database if needed and applies all migrations.
 * Several packages run their tests at the same time, so this holds a Postgres advisory
 * lock (on the server's `postgres` database) while creating and migrating.
 */
export async function prepareTestDatabase(url: string = getTestDatabaseUrl()): Promise<void> {
  const name = new URL(url).pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = '/postgres';

  const adminSql = postgres(admin.toString(), { max: 1, onnotice: () => {} });
  try {
    await adminSql`select pg_advisory_lock(hashtext('fulcra_prepare_test_database'))`;

    const rows = await adminSql`select 1 from pg_database where datname = ${name}`;
    if (rows.length === 0) {
      await adminSql.unsafe(`create database "${name.replace(/"/g, '')}"`);
    }

    const sql = postgres(url, { max: 1, onnotice: () => {} });
    try {
      await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS_FOLDER });
    } finally {
      await sql.end();
    }
  } finally {
    await adminSql.end();
  }
}
