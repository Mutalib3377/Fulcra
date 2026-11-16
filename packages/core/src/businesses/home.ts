import { schema, withTenant } from '@fulcra/db';
import { and, eq, isNotNull, ne, sql } from 'drizzle-orm';
import { requireMember, type ActorContext } from '../members/access';

/** Steps of the "Get set up" checklist, in the order a new seller should do them. */
export const setupStepKeys = [
  'store',
  'brand',
  'products',
  'delivery',
  'payouts',
  'channel',
  'test_chat',
] as const;
export type SetupStepKey = (typeof setupStepKeys)[number];

export type HomeSummary = {
  /** Orders paid today (business's time zone), amounts in kobo. */
  today: { orders: number; amount: number };
  /** Chats waiting for the team. Null for riders (no inbox). */
  chatsWaiting: number | null;
  /** Null for riders. Each step is worked out from the business's data. */
  setup: { steps: { key: SetupStepKey; done: boolean }[]; done: number; total: number } | null;
  hasExternalWebsite: boolean;
};

/** Everything the dashboard home needs besides orders, stock and activity. */
export async function getHomeSummary(actor: ActorContext, now = new Date()): Promise<HomeSummary> {
  return withTenant(actor.businessId, async (tx) => {
    const member = await requireMember(tx, actor);
    const [business] = await tx
      .select({
        timezone: schema.businesses.timezone,
        hasExternalWebsite: schema.businesses.hasExternalWebsite,
        websiteUrl: schema.businesses.websiteUrl,
        subaccount: schema.businesses.paystackSubaccountCode,
      })
      .from(schema.businesses)
      .limit(1);
    const tz = business?.timezone ?? 'Africa/Lagos';
    const o = schema.orders;
    const [sales] = await tx
      .select({
        orders: sql<number>`count(*)::int`,
        amount: sql<number>`coalesce(sum(${o.amountPaid}), 0)::int`,
      })
      .from(o)
      .where(
        and(
          isNotNull(o.paidAt),
          ne(o.status, 'cancelled'),
          sql`(${o.paidAt} at time zone ${tz})::date = (${now.toISOString()}::timestamptz at time zone ${tz})::date`,
        ),
      );
    const today = { orders: sales?.orders ?? 0, amount: sales?.amount ?? 0 };
    const hasExternalWebsite = business?.hasExternalWebsite ?? false;
    if (member.role === 'rider') {
      return { today, chatsWaiting: null, setup: null, hasExternalWebsite };
    }

    const cv = schema.conversations;
    const cn = schema.channelConnections;
    const exists = async (query: { limit: (n: number) => Promise<unknown[]> }) =>
      (await query.limit(1)).length > 0;
    const [waiting] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(cv)
      .where(and(eq(cv.status, 'open'), eq(cv.needsAttention, true)));

    // One after another: queries in a transaction share one connection.
    // Saved once from the Brand kit page.
    const brand = await exists(tx.select({ id: schema.brandKits.id }).from(schema.brandKits));
    const products = await exists(tx.select({ id: schema.products.id }).from(schema.products));
    const delivery = await exists(
      tx.select({ id: schema.deliveryZones.id }).from(schema.deliveryZones),
    );
    const channel = await exists(
      tx
        .select({ id: cn.id })
        .from(cn)
        .where(and(eq(cn.mode, 'live'), eq(cn.status, 'connected'))),
    );
    const testChat = await exists(
      tx
        .select({ id: schema.messages.id })
        .from(schema.messages)
        .innerJoin(cv, eq(cv.id, schema.messages.conversationId))
        .innerJoin(cn, eq(cn.id, cv.connectionId))
        .where(and(eq(cn.mode, 'test'), eq(schema.messages.sender, 'agent'))),
    );
    const done: Record<SetupStepKey, boolean> = {
      // The store is live from sign-up; sellers with their own site add its address.
      store: hasExternalWebsite ? Boolean(business?.websiteUrl) : true,
      brand,
      products,
      delivery,
      payouts: Boolean(business?.subaccount),
      channel,
      test_chat: testChat,
    };
    const steps = setupStepKeys.map((key) => ({ key, done: done[key] }));
    return {
      today,
      chatsWaiting: waiting?.n ?? 0,
      setup: { steps, done: steps.filter((s) => s.done).length, total: steps.length },
      hasExternalWebsite,
    };
  });
}
