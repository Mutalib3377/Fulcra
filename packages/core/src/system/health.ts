import { schema, withSystem } from '@fulcra/db';
import { and, isNull, sql } from 'drizzle-orm';

export type HealthCheck = { ok: boolean; detail?: string };
export type SystemHealth = {
  ok: boolean;
  checks: { database: HealthCheck; queue: HealthCheck; webhooks: HealthCheck };
};

/** Jobs that should have started over 5 minutes ago: more than this means the worker is stuck. */
export const QUEUE_BACKLOG_LIMIT = 50;
/** Webhooks received 10 minutes to a day ago and still not processed. */
export const WEBHOOK_BACKLOG_LIMIT = 20;

/**
 * Deep health check for uptime monitoring: can we reach the database, is the worker keeping up
 * with jobs, are webhooks being processed. Counts only, no business data (`withSystem`).
 */
export async function systemHealth(): Promise<SystemHealth> {
  let checks: SystemHealth['checks'];
  try {
    checks = await withSystem(async (tx) => {
      await tx.execute(sql`select 1`);
      // pg-boss creates its tables when the worker first starts.
      const [table] = await tx.execute<{ exists: boolean }>(
        sql`select to_regclass('pgboss.job') is not null as exists`,
      );
      const queue = table?.exists
        ? await tx.execute<{ n: number }>(sql`
            select count(*)::int as n from pgboss.job
            where state in ('created', 'retry') and start_after < now() - interval '5 minutes'`)
        : null;
      const w = schema.webhookEvents;
      const [hooks] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(w)
        .where(
          and(
            isNull(w.processedAt),
            sql`${w.receivedAt} between now() - interval '1 day' and now() - interval '10 minutes'`,
          ),
        );
      const waiting = Number(queue?.[0]?.n ?? 0);
      const stuck = hooks?.n ?? 0;
      return {
        database: { ok: true },
        queue: queue
          ? { ok: waiting <= QUEUE_BACKLOG_LIMIT, detail: `${waiting} late jobs` }
          : { ok: false, detail: 'queue not set up yet (start the worker)' },
        webhooks: { ok: stuck <= WEBHOOK_BACKLOG_LIMIT, detail: `${stuck} unprocessed` },
      };
    });
  } catch {
    checks = {
      database: { ok: false, detail: 'unreachable' },
      queue: { ok: false, detail: 'unknown' },
      webhooks: { ok: false, detail: 'unknown' },
    };
  }
  return { ok: Object.values(checks).every((c) => c.ok), checks };
}
