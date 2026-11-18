/**
 * Applies pending migrations, for deploys (Render runs it before the new worker starts).
 * Uses drizzle-orm's migrator, so it needs no dev tools in the production image; it shares
 * drizzle-kit's migrations table, so `pnpm db:migrate` and this see the same history.
 * Connects with DATABASE_URL_MIGRATIONS (direct connection, database owner) or DATABASE_URL.
 */
import path from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const url = process.env.DATABASE_URL_MIGRATIONS || process.env.DATABASE_URL;
if (!url) {
  console.error('[migrate] Set DATABASE_URL_MIGRATIONS (or DATABASE_URL).');
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
try {
  await migrate(drizzle(sql), {
    migrationsFolder: path.join(import.meta.dirname, '../migrations'),
  });
  console.info('[migrate] Database is up to date.');
} catch (error) {
  console.error('[migrate] Failed:', error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
