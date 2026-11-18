import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
});

/** Reads and validates the database connection string from the environment. */
export function getDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      'DATABASE_URL is missing or invalid. Copy .env.example to .env and run `pnpm db:up`.',
    );
  }
  return parsed.data.DATABASE_URL;
}

/**
 * Connection for the job queue (pg-boss). Defaults to DATABASE_URL. In production DATABASE_URL
 * points at Supabase's transaction pooler; the queue may use the session pooler instead.
 */
export function getQueueDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.DATABASE_URL_QUEUE || getDatabaseUrl(env);
}

/** Connections per process (DB_POOL_MAX, default 10). Keep the total under the pooler's limit. */
export function getPoolSize(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.DB_POOL_MAX);
  return Number.isInteger(n) && n > 0 && n <= 100 ? n : 10;
}
