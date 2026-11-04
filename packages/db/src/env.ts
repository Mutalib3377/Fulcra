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
