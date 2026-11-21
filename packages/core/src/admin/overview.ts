import { schema, withSystem, withTenant } from '@fulcra/db';
import { and, asc, desc, eq, gte, ilike, isNotNull, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { planStateInTx } from '../billing/entitlements';
import { effectiveStatus, PLANS, type EffectiveStatus, type PlanCode } from '../billing/rules';
import { CoreError } from '../shared/errors';
import { systemHealth, type SystemHealth } from '../system/health';
import { requireAdmin, usdToNairaRate, type AdminActor } from './access';

/**
 * What Fulcra's staff see across all businesses (AD1, docs/decisions/0027). These are the
 * only Core services that read every business at once (system access, listed in 0003); a
 * single business's details are read with `withTenant` for that business.
 */

const b = schema.businesses;
const s = schema.subscriptions;
const o = schema.orders;
const u = schema.usageRecords;

/** Start of the month and of today, Lagos time (UTC+1, no daylight saving). */
export function lagosPeriods(now = new Date()) {
  const lagos = new Date(now.getTime() + 3_600_000).toISOString();
  const day = lagos.slice(0, 10);
  return {
    today: new Date(`${day}T00:00:00+01:00`),
    month: new Date(`${day.slice(0, 7)}-01T00:00:00+01:00`),
    days: (n: number) => new Date(now.getTime() - n * 86_400_000),
  };
}

const asPlan = (code: string | null | undefined): PlanCode =>
  code === 'starter' || code === 'growth' || code === 'pro' ? code : 'growth';

/** Monthly value of a paid subscription, in kobo (yearly plans count a twelfth). */
function monthlyValue(planCode: string, interval: string): number {
  const plan = PLANS[asPlan(planCode)];
  return interval === 'annual' ? Math.round(plan.annualPrice / 12) : plan.monthlyPrice;
}

/** Statuses that pay us (or have paid for the current period). */
const PAYING: EffectiveStatus[] = ['active', 'past_due', 'cancelled'];

export type AdminOverview = {
  businesses: { total: number; today: number; last7: number; last30: number };
  plans: {
    trialing: number;
    expired: number;
    paying: number;
    byPlan: Record<PlanCode, number>;
    /** Monthly subscription value, kobo. */
    monthlyRecurring: number;
  };
  thisMonth: {
    /** Plan payments received, kobo. */
    subscriptionIncome: number;
    /** Paid orders sellers took through Fulcra (store, links, transfers, recorded). */
    sellerSales: number;
    sellerOrders: number;
    /** What AI and WhatsApp cost us, in dollars and in naira at the rate below. */
    costUsd: { ai: number; whatsapp: number; total: number };
    costNaira: number;
    usdToNaira: number;
  };
  health: SystemHealth;
};

/** The numbers on the admin home page. */
export async function adminOverview(admin: AdminActor, now = new Date()): Promise<AdminOverview> {
  requireAdmin(admin);
  const p = lagosPeriods(now);
  const data = await withSystem(async (tx) => {
    const [counts] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        today: sql<number>`count(*) filter (where ${b.createdAt} >= ${p.today.toISOString()}::timestamptz)::int`,
        last7: sql<number>`count(*) filter (where ${b.createdAt} >= ${p.days(7).toISOString()}::timestamptz)::int`,
        last30: sql<number>`count(*) filter (where ${b.createdAt} >= ${p.days(30).toISOString()}::timestamptz)::int`,
      })
      .from(b);
    const subs = await tx
      .select({
        status: s.status,
        planCode: s.planCode,
        interval: s.interval,
        trialEndsAt: s.trialEndsAt,
        currentPeriodEnd: s.currentPeriodEnd,
        graceEndsAt: s.graceEndsAt,
      })
      .from(s);
    const [income] = await tx
      .select({ total: sql<number>`coalesce(sum(${schema.subscriptionPayments.amount}), 0)::int` })
      .from(schema.subscriptionPayments)
      .where(gte(schema.subscriptionPayments.paidAt, p.month));
    const [sales] = await tx
      .select({
        total: sql<number>`coalesce(sum(${o.amountPaid}), 0)::bigint`,
        orders: sql<number>`count(*)::int`,
      })
      .from(o)
      .where(and(isNotNull(o.paidAt), gte(o.paidAt, p.month), ne(o.status, 'cancelled')));
    const costs = await tx
      .select({ kind: u.kind, total: sql<number>`coalesce(sum(${u.costUsd}), 0)::float` })
      .from(u)
      .where(gte(u.createdAt, p.month))
      .groupBy(u.kind);
    return { counts, subs, income, sales, costs };
  });

  const byPlan: Record<PlanCode, number> = { starter: 0, growth: 0, pro: 0 };
  let trialing = 0;
  let expired = 0;
  let paying = 0;
  let monthlyRecurring = 0;
  for (const sub of data.subs) {
    const status = effectiveStatus(sub, now);
    if (status === 'trialing') trialing++;
    else if (PAYING.includes(status)) {
      paying++;
      byPlan[asPlan(sub.planCode)]++;
      // Cancelled plans stop renewing: they are paid up but not recurring.
      if (status !== 'cancelled') monthlyRecurring += monthlyValue(sub.planCode, sub.interval);
    } else expired++;
  }
  const ai = data.costs.find((c) => c.kind === 'ai_call')?.total ?? 0;
  const whatsapp = data.costs.find((c) => c.kind === 'whatsapp_message')?.total ?? 0;
  const rate = usdToNairaRate();
  const totalUsd = ai + whatsapp;
  return {
    businesses: {
      total: data.counts?.total ?? 0,
      today: data.counts?.today ?? 0,
      last7: data.counts?.last7 ?? 0,
      last30: data.counts?.last30 ?? 0,
    },
    plans: { trialing, expired, paying, byPlan, monthlyRecurring },
    thisMonth: {
      subscriptionIncome: data.income?.total ?? 0,
      sellerSales: Number(data.sales?.total ?? 0),
      sellerOrders: data.sales?.orders ?? 0,
      costUsd: { ai: round(ai), whatsapp: round(whatsapp), total: round(totalUsd) },
      costNaira: Math.round(totalUsd * rate * 100),
      usdToNaira: rate,
    },
    health: await systemHealth(),
  };
}

/** Dollars to 4 decimals: one seller's cost can be a fraction of a cent. */
const round = (n: number) => Math.round(n * 10_000) / 10_000;

// ─── Sellers list ────────────────────────────────────────────────────────────

export const adminBusinessFilter = z.object({
  q: z.string().trim().max(100).default(''),
  status: z.enum(['all', 'trialing', 'paying', 'expired']).default('all'),
  page: z.coerce.number().int().min(1).max(1000).catch(1).default(1),
});

export type AdminBusinessRow = {
  id: string;
  name: string;
  subdomain: string;
  ownerEmail: string | null;
  createdAt: Date;
  plan: PlanCode;
  status: EffectiveStatus;
  ordersThisMonth: number;
  salesThisMonth: number;
  chatsThisMonth: number;
  /** What this seller cost us this month (AI and WhatsApp), dollars. */
  costUsdThisMonth: number;
};

const PAGE_SIZE = 50;
/** Rows read before the status filter (plenty while there are hundreds of sellers). */
const SCAN_LIMIT = 2000;

/** All businesses, newest first, with this month's activity and cost. */
export async function adminListBusinesses(
  admin: AdminActor,
  filter: z.input<typeof adminBusinessFilter> = {},
  now = new Date(),
): Promise<{ rows: AdminBusinessRow[]; page: number; hasMore: boolean; total: number }> {
  requireAdmin(admin);
  const f = adminBusinessFilter.parse(filter);
  const month = lagosPeriods(now).month.toISOString();
  const owner = sql<
    string | null
  >`(select ${schema.members.email} from ${schema.members} where ${schema.members.businessId} = ${b.id} and ${schema.members.role} = 'owner' order by ${schema.members.createdAt} limit 1)`;
  const like = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await withSystem((tx) =>
    tx
      .select({
        id: b.id,
        name: b.name,
        subdomain: b.subdomain,
        createdAt: b.createdAt,
        ownerEmail: owner,
        sub: {
          status: s.status,
          planCode: s.planCode,
          trialEndsAt: s.trialEndsAt,
          currentPeriodEnd: s.currentPeriodEnd,
          graceEndsAt: s.graceEndsAt,
        },
        ordersThisMonth: sql<number>`(select count(*)::int from ${o} where ${o.businessId} = ${b.id} and ${o.createdAt} >= ${month}::timestamptz)`,
        salesThisMonth: sql<number>`(select coalesce(sum(${o.amountPaid}), 0)::bigint from ${o} where ${o.businessId} = ${b.id} and ${o.paidAt} >= ${month}::timestamptz and ${o.status} <> 'cancelled')`,
        chatsThisMonth: sql<number>`(select count(*)::int from ${u} where ${u.businessId} = ${b.id} and ${u.kind} = 'agent_conversation' and ${u.createdAt} >= ${month}::timestamptz)`,
        costUsdThisMonth: sql<number>`(select coalesce(sum(${u.costUsd}), 0)::float from ${u} where ${u.businessId} = ${b.id} and ${u.createdAt} >= ${month}::timestamptz)`,
      })
      .from(b)
      .leftJoin(s, eq(s.businessId, b.id))
      .where(
        f.q
          ? or(
              ilike(b.name, like),
              ilike(b.subdomain, like),
              sql`exists (select 1 from ${schema.members} where ${schema.members.businessId} = ${b.id} and ${schema.members.email} ilike ${like})`,
            )
          : undefined,
      )
      .orderBy(desc(b.createdAt), asc(b.id))
      .limit(SCAN_LIMIT),
  );
  const all = rows
    .map((r): AdminBusinessRow => {
      const status: EffectiveStatus = r.sub?.status ? effectiveStatus(r.sub, now) : 'trialing';
      return {
        id: r.id,
        name: r.name,
        subdomain: r.subdomain,
        ownerEmail: r.ownerEmail,
        createdAt: r.createdAt,
        plan: asPlan(r.sub?.planCode),
        status,
        ordersThisMonth: r.ordersThisMonth,
        salesThisMonth: Number(r.salesThisMonth),
        chatsThisMonth: r.chatsThisMonth,
        costUsdThisMonth: round(r.costUsdThisMonth),
      };
    })
    .filter((r) =>
      f.status === 'all'
        ? true
        : f.status === 'paying'
          ? PAYING.includes(r.status)
          : r.status === f.status,
    );
  const start = (f.page - 1) * PAGE_SIZE;
  return {
    rows: all.slice(start, start + PAGE_SIZE),
    page: f.page,
    hasMore: all.length > start + PAGE_SIZE,
    total: all.length,
  };
}

// ─── One seller ──────────────────────────────────────────────────────────────

export type AdminBusinessDetail = {
  id: string;
  name: string;
  subdomain: string;
  category: string;
  whatsappNumber: string;
  hasExternalWebsite: boolean;
  websiteUrl: string | null;
  createdAt: Date;
  payoutConfigured: boolean;
  payoutBankName: string | null;
  team: { email: string; role: string; joinedAt: Date }[];
  plan: {
    code: PlanCode;
    name: string;
    status: EffectiveStatus;
    interval: string | null;
    trialEndsAt: Date | null;
    currentPeriodEnd: Date | null;
    conversationLimit: number;
  };
  overrides: {
    featureKey: string;
    enabled: boolean | null;
    limitValue: number | null;
    note: string;
  }[];
  channels: { channel: string; mode: string; status: string; name: string }[];
  counts: { products: number; customers: number; orders: number; paidOrders: number };
  thisMonth: {
    chats: number;
    ownerMessages: number;
    sales: number;
    costUsd: { feature: string; total: number }[];
    costUsdTotal: number;
  };
  recentOrders: {
    id: string;
    orderNumber: number;
    status: string;
    total: number;
    channel: string;
    createdAt: Date;
  }[];
};

/** Everything about one seller for the admin seller page. */
export async function adminGetBusiness(
  admin: AdminActor,
  businessId: string,
  now = new Date(),
): Promise<AdminBusinessDetail> {
  requireAdmin(admin);
  const parsed = z.uuid().safeParse(businessId);
  if (!parsed.success) throw new CoreError('not_found', 'This business does not exist.');
  const id = parsed.data;
  const month = lagosPeriods(now).month;
  return withTenant(id, async (tx) => {
    const [business] = await tx.select().from(b).where(eq(b.id, id)).limit(1);
    if (!business) throw new CoreError('not_found', 'This business does not exist.');
    const state = await planStateInTx(tx, now);
    const [sub] = await tx.select().from(s).limit(1);
    const team = await tx
      .select({
        email: schema.members.email,
        role: schema.members.role,
        joinedAt: schema.members.createdAt,
      })
      .from(schema.members)
      .orderBy(asc(schema.members.createdAt));
    const overrides = await tx
      .select({
        featureKey: schema.entitlements.featureKey,
        enabled: schema.entitlements.enabled,
        limitValue: schema.entitlements.limitValue,
        note: schema.entitlements.note,
      })
      .from(schema.entitlements)
      .orderBy(asc(schema.entitlements.featureKey));
    const channels = await tx
      .select({
        channel: schema.channelConnections.channel,
        mode: schema.channelConnections.mode,
        status: schema.channelConnections.status,
        name: schema.channelConnections.displayName,
      })
      .from(schema.channelConnections)
      .orderBy(asc(schema.channelConnections.channel));
    const count = async (table: typeof schema.products | typeof schema.customers) => {
      const [row] = await tx.select({ n: sql<number>`count(*)::int` }).from(table);
      return row?.n ?? 0;
    };
    const [orders] = await tx
      .select({
        all: sql<number>`count(*)::int`,
        paid: sql<number>`count(*) filter (where ${o.paidAt} is not null)::int`,
        salesThisMonth: sql<number>`coalesce(sum(${o.amountPaid}) filter (where ${o.paidAt} >= ${month.toISOString()}::timestamptz and ${o.status} <> 'cancelled'), 0)::bigint`,
      })
      .from(o);
    const usage = await tx
      .select({
        kind: u.kind,
        feature: u.feature,
        n: sql<number>`count(*)::int`,
        total: sql<number>`coalesce(sum(${u.costUsd}), 0)::float`,
      })
      .from(u)
      .where(gte(u.createdAt, month))
      .groupBy(u.kind, u.feature);
    const [ownerMessages] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.ownerChatMessages)
      .where(
        and(
          eq(schema.ownerChatMessages.sender, 'owner'),
          gte(schema.ownerChatMessages.createdAt, month),
        ),
      );
    const recentOrders = await tx
      .select({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        total: o.total,
        channel: o.channel,
        createdAt: o.createdAt,
      })
      .from(o)
      .orderBy(desc(o.createdAt))
      .limit(10);
    const costByFeature = new Map<string, number>();
    for (const row of usage) {
      if (row.kind === 'agent_conversation') continue;
      costByFeature.set(row.feature, (costByFeature.get(row.feature) ?? 0) + row.total);
    }
    const costUsd = [...costByFeature]
      .map(([feature, total]) => ({ feature, total: round(total) }))
      .sort((x, y) => y.total - x.total);
    return {
      id: business.id,
      name: business.name,
      subdomain: business.subdomain,
      category: business.category,
      whatsappNumber: business.whatsappNumber,
      hasExternalWebsite: business.hasExternalWebsite,
      websiteUrl: business.websiteUrl,
      createdAt: business.createdAt,
      payoutConfigured: Boolean(business.paystackSubaccountCode),
      payoutBankName: business.payoutBankName,
      team,
      plan: {
        code: state.plan.code,
        name: state.plan.name,
        status: state.status,
        interval: sub?.interval ?? null,
        trialEndsAt: state.trialEndsAt,
        currentPeriodEnd: state.currentPeriodEnd,
        conversationLimit: state.conversationLimit,
      },
      overrides,
      channels,
      counts: {
        products: await count(schema.products),
        customers: await count(schema.customers),
        orders: orders?.all ?? 0,
        paidOrders: orders?.paid ?? 0,
      },
      thisMonth: {
        chats: usage
          .filter((r) => r.kind === 'agent_conversation')
          .reduce((sum, r) => sum + r.n, 0),
        ownerMessages: ownerMessages?.n ?? 0,
        sales: Number(orders?.salesThisMonth ?? 0),
        costUsd,
        costUsdTotal: round(costUsd.reduce((sum, r) => sum + r.total, 0)),
      },
      recentOrders,
    };
  });
}
