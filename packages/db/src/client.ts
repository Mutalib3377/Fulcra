import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { getDatabaseUrl } from './env';
import * as schema from './schema';

export type Database = ReturnType<typeof createDb>;

/**
 * Creates a Drizzle client. Prefer the shared `getDb()` in app code;
 * use this directly in scripts and tests that manage their own connection.
 */
export function createDb(
  url: string = getDatabaseUrl(),
  options: postgres.Options<Record<string, postgres.PostgresType>> = {},
) {
  // `prepare: false` keeps us compatible with Supabase's transaction pooler.
  const sql = postgres(url, { prepare: false, max: 10, ...options });
  return drizzle(sql, { schema });
}

let shared: Database | undefined;

/** Lazily created, process-wide database client. */
export function getDb(): Database {
  shared ??= createDb();
  return shared;
}
