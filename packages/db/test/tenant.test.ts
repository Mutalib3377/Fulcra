import { eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { getDb } from '../src/client';
import { businesses, members, webhookEvents } from '../src/schema';
import { withSystem, withTenant } from '../src/tenant';
import { getTestDatabaseUrl } from '../src/testing';

const unique = () => Math.random().toString(36).slice(2, 10);

async function makeBusiness(label: string) {
  const [row] = await withSystem((tx) =>
    tx
      .insert(businesses)
      .values({
        name: `${label} ${unique()}`,
        subdomain: `t-${label}-${unique()}`,
        category: 'fashion',
        whatsappNumber: '+2348012345678',
      })
      .returning(),
  );
  if (!row) throw new Error('insert failed');
  return row;
}

afterAll(async () => {
  // Release the shared pool so Vitest can exit.
  await getDb().$client.end();
});

describe('withTenant', () => {
  it('only sees the current business, even with no WHERE clause', async () => {
    const a = await makeBusiness('a');
    const b = await makeBusiness('b');

    const seenByA = await withTenant(a.id, (tx) => tx.select().from(businesses));
    expect(seenByA.map((r) => r.id)).toEqual([a.id]);

    const seenByB = await withTenant(b.id, (tx) => tx.select().from(businesses));
    expect(seenByB.map((r) => r.id)).toEqual([b.id]);
  });

  it('cannot update or delete another business', async () => {
    const a = await makeBusiness('a');
    const b = await makeBusiness('b');

    const updated = await withTenant(a.id, (tx) =>
      tx.update(businesses).set({ name: 'hacked' }).where(eq(businesses.id, b.id)).returning(),
    );
    expect(updated).toEqual([]);

    const deleted = await withTenant(a.id, (tx) =>
      tx.delete(businesses).where(eq(businesses.id, b.id)).returning(),
    );
    expect(deleted).toEqual([]);

    const [stillThere] = await withSystem((tx) =>
      tx.select().from(businesses).where(eq(businesses.id, b.id)),
    );
    expect(stillThere?.name).toBe(b.name);
  });

  it('cannot insert rows for another business', async () => {
    const a = await makeBusiness('a');
    const b = await makeBusiness('b');

    await expect(
      withTenant(a.id, (tx) =>
        tx.insert(members).values({
          businessId: b.id,
          userId: crypto.randomUUID(),
          email: 'x@example.com',
          role: 'staff',
        }),
      ),
    ).rejects.toThrow();
  });

  it('runs as the restricted role and resets afterwards', async () => {
    const a = await makeBusiness('a');
    const inside = await withTenant(a.id, (tx) =>
      tx.execute<{ role: string }>(sql`select current_user as role`),
    );
    expect(inside[0]?.role).toBe('fulcra_app');

    const outside = await getDb().execute<{ setting: string | null }>(
      sql`select current_user as role, nullif(current_setting('app.business_id', true), '') as setting`,
    );
    expect(outside[0]?.setting).toBeNull();
  });

  it('rejects a business id that is not a uuid', async () => {
    await expect(withTenant("x' or 1=1 --", async () => 1)).rejects.toThrow();
  });
});

describe('webhook_events', () => {
  it('is invisible to tenant queries (system-only table)', async () => {
    const a = await makeBusiness('a');
    await withSystem((tx) =>
      tx
        .insert(webhookEvents)
        .values({ provider: 'test', eventId: `e-${unique()}`, eventType: 'x', payload: {} }),
    );
    expect(await withTenant(a.id, (tx) => tx.select().from(webhookEvents))).toEqual([]);
    expect((await withSystem((tx) => tx.select().from(webhookEvents))).length).toBeGreaterThan(0);
  });
});

describe('RLS coverage', () => {
  it('every table with business_id (and businesses) has RLS and a policy for fulcra_app', async () => {
    const sqlClient = postgres(getTestDatabaseUrl(), { max: 1 });
    try {
      const rows = await sqlClient<{ table: string; rls: boolean; policies: number }[]>`
        select c.relname as table,
               c.relrowsecurity as rls,
               (select count(*)::int from pg_policies p
                 where p.schemaname = 'public' and p.tablename = c.relname
                   and 'fulcra_app' = any(p.roles)) as policies
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
          and (c.relname = 'businesses' or exists (
            select 1 from information_schema.columns col
            where col.table_schema = 'public' and col.table_name = c.relname
              and col.column_name = 'business_id'))`;
      expect(rows.length).toBeGreaterThanOrEqual(3);
      const unprotected = rows.filter((r) => !r.rls || r.policies === 0).map((r) => r.table);
      expect(unprotected).toEqual([]);
    } finally {
      await sqlClient.end();
    }
  });
});
