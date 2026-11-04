import { z } from 'zod';

const schema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

/** Supabase connection settings, read at runtime on the server. */
export function getSupabaseEnv() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error('SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY are missing. See .env.example.');
  }
  return { url: parsed.data.SUPABASE_URL, key: parsed.data.SUPABASE_PUBLISHABLE_KEY };
}
