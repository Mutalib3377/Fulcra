import { schema, withSystem } from '@fulcra/db';
import { lt, sql } from 'drizzle-orm';

/**
 * Counts one request against `key` and says whether it is allowed: at most `max` requests per
 * window (fixed window). Shared by every web instance through the database. Cross-business by
 * nature (keys are visitor addresses), so it runs with `withSystem` (docs/decisions/0003).
 */
export async function consumeRateLimit(
  key: string,
  max: number,
  windowMs: number,
): Promise<boolean> {
  const seconds = Math.max(1, Math.round(windowMs / 1000));
  const rl = schema.rateLimits;
  const count = await withSystem(async (tx) => {
    const [row] = await tx
      .insert(rl)
      .values({ key, count: 1 })
      .onConflictDoUpdate({
        target: rl.key,
        set: {
          count: sql`case when ${rl.windowStart} < now() - make_interval(secs => ${seconds}) then 1 else ${rl.count} + 1 end`,
          windowStart: sql`case when ${rl.windowStart} < now() - make_interval(secs => ${seconds}) then now() else ${rl.windowStart} end`,
        },
      })
      .returning({ count: rl.count });
    return row?.count ?? 1;
  });
  // Now and then, forget counters that have been idle for a day.
  if (Math.random() < 0.002) await pruneRateLimits();
  return count <= max;
}

/** Deletes counters idle for more than a day. */
export async function pruneRateLimits(): Promise<number> {
  return withSystem(async (tx) => {
    const rows = await tx
      .delete(schema.rateLimits)
      .where(lt(schema.rateLimits.windowStart, sql`now() - interval '1 day'`))
      .returning({ key: schema.rateLimits.key });
    return rows.length;
  });
}
