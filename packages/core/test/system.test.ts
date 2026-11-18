import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

const { schema, withSystem } = await import('@fulcra/db');
const { eq, sql } = await import('drizzle-orm');
const { consumeRateLimit, pruneRateLimits } = await import('../src/system/rate-limit');
const { systemHealth, WEBHOOK_BACKLOG_LIMIT } = await import('../src/system/health');

describe('consumeRateLimit', () => {
  it('allows up to the limit in a window, then refuses', async () => {
    const key = `test:${randomUUID()}`;
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await consumeRateLimit(key, 3, 60_000));
    expect(results).toEqual([true, true, true, false]);
  });

  it('starts counting again when the window has passed', async () => {
    const key = `test:${randomUUID()}`;
    for (let i = 0; i < 3; i++) await consumeRateLimit(key, 3, 60_000);
    expect(await consumeRateLimit(key, 3, 60_000)).toBe(false);
    await withSystem((tx) =>
      tx
        .update(schema.rateLimits)
        .set({ windowStart: sql`now() - interval '2 minutes'` })
        .where(eq(schema.rateLimits.key, key)),
    );
    expect(await consumeRateLimit(key, 3, 60_000)).toBe(true);
  });

  it('counts concurrent requests exactly once each', async () => {
    const key = `test:${randomUUID()}`;
    const results = await Promise.all(
      Array.from({ length: 10 }, () => consumeRateLimit(key, 5, 60_000)),
    );
    expect(results.filter(Boolean)).toHaveLength(5);
  });

  it('forgets counters idle for a day', async () => {
    const key = `test:${randomUUID()}`;
    await consumeRateLimit(key, 3, 60_000);
    await withSystem((tx) =>
      tx
        .update(schema.rateLimits)
        .set({ windowStart: sql`now() - interval '2 days'` })
        .where(eq(schema.rateLimits.key, key)),
    );
    expect(await pruneRateLimits()).toBeGreaterThanOrEqual(1);
    const rows = await withSystem((tx) =>
      tx.select().from(schema.rateLimits).where(eq(schema.rateLimits.key, key)),
    );
    expect(rows).toHaveLength(0);
  });
});

describe('systemHealth', () => {
  it('reports the database and webhook backlog', async () => {
    const before = await systemHealth();
    expect(before.checks.database.ok).toBe(true);
    expect(before.checks.webhooks.detail).toMatch(/unprocessed/);

    // Webhooks stuck for an hour beyond the limit make the check fail.
    const batch = randomUUID();
    await withSystem((tx) =>
      tx.insert(schema.webhookEvents).values(
        Array.from({ length: WEBHOOK_BACKLOG_LIMIT + 1 }, (_, i) => ({
          provider: 'health-test',
          eventId: `${batch}:${i}`,
          eventType: 'test',
          payload: {},
          receivedAt: sql`now() - interval '1 hour'`,
        })),
      ),
    );
    try {
      const after = await systemHealth();
      expect(after.checks.webhooks.ok).toBe(false);
      expect(after.ok).toBe(false);
    } finally {
      await withSystem((tx) =>
        tx.delete(schema.webhookEvents).where(eq(schema.webhookEvents.provider, 'health-test')),
      );
    }
  });
});
