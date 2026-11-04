import { defineConfig } from 'drizzle-kit';

// Migrations run as the database owner. The app itself will connect as a restricted
// role once RLS is added in C1 (docs/decisions/0003), so prefer DATABASE_URL_MIGRATIONS.
const url = process.env.DATABASE_URL_MIGRATIONS || process.env.DATABASE_URL;
if (!url) {
  throw new Error('Set DATABASE_URL (or DATABASE_URL_MIGRATIONS) in .env');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
