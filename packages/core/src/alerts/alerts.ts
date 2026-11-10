import { randomUUID } from 'node:crypto';
import { formatNaira } from '@fulcra/config';
import { schema, withSystem, withTenant, type Tx } from '@fulcra/db';
import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { templateParam } from '../conversations/templates';
import { enqueueOwnerAlertsNow } from '../jobs/queue';
import { requireMember, type ActorContext } from '../members/access';
import { dashboardUrl } from '../payments/urls';
import { CoreError } from '../shared/errors';
import { recordWhatsAppUsage } from '../usage/usage';
import { alertText, approvedPlatformTemplate, platformWhatsApp, type AlertKind } from './platform';
import { toAlertSettingsView } from './settings';

/**
 * Owner alerts and the daily briefing, sent from Fulcra's WhatsApp number (A4,
 * docs/decisions/0015). The worker runs every minute: it turns new events into alerts (once
 * per event), sends the ones whose template is approved, and adds the briefing when due.
 */

const oa = schema.ownerAlerts;
const ev = schema.events;
const LOOKBACK_MS = 24 * 3_600_000;

/** Businesses whose owner set an alert number (system access: the job's list, 0003). */
export async function businessesWithAlerts(): Promise<string[]> {
  const rows = await withSystem((tx) =>
    tx
      .select({ businessId: schema.ownerNotificationSettings.businessId })
      .from(schema.ownerNotificationSettings)
      .where(isNotNull(schema.ownerNotificationSettings.ownerWhatsapp)),
  );
  return rows.map((r) => r.businessId);
}

async function insertAlert(
  tx: Tx,
  businessId: string,
  alert: { kind: AlertKind; key: string; eventId?: string; to: string; params: string[] },
): Promise<string | null> {
  const params = alert.params.map(templateParam);
  const [row] = await tx
    .insert(oa)
    .values({
      businessId,
      kind: alert.kind,
      dedupeKey: alert.key,
      eventId: alert.eventId ?? null,
      toPhone: alert.to,
      params,
      text: alertText(alert.kind, params),
    })
    .onConflictDoNothing()
    .returning({ id: oa.id });
  return row?.id ?? null;
}

const asString = (v: unknown) => (typeof v === 'string' ? v : '');
const asNumber = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * Turns the last day's events into alerts the owner asked for (once per event): paid orders,
 * low stock, payments that need checking, and chats the assistant passed to the team.
 * Events from before the alerts were set up are skipped. Returns how many were added.
 */
export async function createPendingAlerts(businessId: string, now = new Date()): Promise<number> {
  return withTenant(businessId, async (tx) => {
    const [row] = await tx.select().from(schema.ownerNotificationSettings).limit(1);
    const settings = toAlertSettingsView(row);
    if (!row || !settings.ownerWhatsapp) return 0;
    const types = [
      ...(settings.alertPaidOrders ? ['order.paid', 'payment.confirmed'] : []),
      ...(settings.alertLowStock ? ['stock.low'] : []),
      ...(settings.alertUnmatchedPayments ? ['payment.unmatched', 'payment.needs_review'] : []),
      ...(settings.alertWaitingCustomers ? ['conversation.handoff'] : []),
    ];
    if (types.length === 0) return 0;
    const since = new Date(Math.max(now.getTime() - LOOKBACK_MS, row.createdAt.getTime()));
    const events = await tx
      .select()
      .from(ev)
      .where(
        and(
          eq(ev.businessId, businessId),
          gt(ev.createdAt, since),
          inArray(ev.type, types),
          sql`not (${ev.type} = 'conversation.handoff' and (${ev.actorType} <> 'agent' or coalesce(${ev.payload}->>'to', '') <> 'human'))`,
          sql`not exists (select 1 from ${oa} where ${oa.businessId} = ${businessId} and ${oa.dedupeKey} = 'event:' || ${ev.id}::text)`,
        ),
      )
      .orderBy(ev.createdAt)
      .limit(100);
    if (events.length === 0) return 0;
    const [business] = await tx
      .select({ name: schema.businesses.name })
      .from(schema.businesses)
      .limit(1);
    const shop = business?.name ?? '';
    let added = 0;
    for (const event of events) {
      const p = event.payload;
      let kind: AlertKind;
      let params: string[];
      if (event.type === 'order.paid' || event.type === 'payment.confirmed') {
        const [order] = event.orderId
          ? await tx
              .select()
              .from(schema.orders)
              .where(eq(schema.orders.id, event.orderId))
              .limit(1)
          : [];
        if (!order) continue;
        const [customer] = await tx
          .select({ name: schema.customers.name })
          .from(schema.customers)
          .where(eq(schema.customers.id, order.customerId))
          .limit(1);
        kind = 'paid_order';
        params = [
          `#${order.orderNumber}`,
          shop,
          formatNaira(asNumber(p.amount) || order.total),
          customer?.name || 'a customer',
          dashboardUrl(`/orders/${order.id}`),
        ];
      } else if (event.type === 'stock.low') {
        const name = asString(p.productName);
        const label = asString(p.variantLabel);
        kind = 'low_stock';
        params = [
          shop,
          label && !/^default$/i.test(label) ? `${name} (${label})` : name,
          String(asNumber(p.stock)),
          dashboardUrl(`/catalog/${asString(p.productId)}`),
        ];
      } else if (event.type === 'payment.unmatched' || event.type === 'payment.needs_review') {
        kind = 'unmatched_payment';
        params = [formatNaira(asNumber(p.amount)), shop, dashboardUrl('/payments')];
      } else {
        const [customer] = event.customerId
          ? await tx
              .select({ name: schema.customers.name })
              .from(schema.customers)
              .where(eq(schema.customers.id, event.customerId))
              .limit(1)
          : [];
        kind = 'waiting_customer';
        params = [
          customer?.name || 'A customer',
          shop,
          asString(p.reason) || 'The assistant passed the chat to you',
          dashboardUrl(`/inbox/${asString(p.conversationId)}`),
        ];
      }
      const id = await insertAlert(tx, businessId, {
        kind,
        key: `event:${event.id}`,
        eventId: event.id,
        to: settings.ownerWhatsapp,
        params,
      });
      if (id) added++;
    }
    return added;
  });
}

// ─── Daily briefing ──────────────────────────────────────────────────────────

function localParts(now: Date, timeZone: string) {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone }).format(now); // YYYY-MM-DD
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now);
  return { date, time };
}

/**
 * Adds today's briefing when it is due (after the owner's chosen time, once per local day).
 * It covers yesterday's sales and what is waiting right now. Returns the alert id or null.
 */
export async function createBriefingIfDue(
  businessId: string,
  now = new Date(),
): Promise<string | null> {
  return withTenant(businessId, async (tx) => {
    const [row] = await tx.select().from(schema.ownerNotificationSettings).limit(1);
    const settings = toAlertSettingsView(row);
    if (!row || !settings.ownerWhatsapp || !settings.briefingEnabled) return null;
    const [business] = await tx
      .select({ name: schema.businesses.name, timezone: schema.businesses.timezone })
      .from(schema.businesses)
      .limit(1);
    if (!business) return null;
    const tz = business.timezone;
    const { date, time } = localParts(now, tz);
    if (time < settings.briefingTime) return null;
    const key = `briefing:${date}`;
    const [done] = await tx.select({ id: oa.id }).from(oa).where(eq(oa.dedupeKey, key)).limit(1);
    if (done) return null;

    const yesterday = new Date(`${date}T12:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayIso = yesterday.toISOString().slice(0, 10);
    const label = new Intl.DateTimeFormat('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }).format(yesterday);
    const o = schema.orders;
    const [sales] = await tx
      .select({
        n: sql<number>`count(*)::int`,
        total: sql<number>`coalesce(sum(${o.amountPaid}), 0)::int`,
      })
      .from(o)
      .where(
        and(
          isNotNull(o.paidAt),
          sql`(${o.paidAt} at time zone ${tz})::date = ${yesterdayIso}::date`,
          sql`${o.status} <> 'cancelled'`,
        ),
      );
    const [unpaid] = await tx
      .select({
        n: sql<number>`count(*)::int`,
        total: sql<number>`coalesce(sum(${o.total}), 0)::int`,
      })
      .from(o)
      .where(inArray(o.status, ['new', 'awaiting_payment']));
    const [toSend] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(o)
      .where(eq(o.status, 'paid'));
    const [low] = await tx
      .select({ n: sql<number>`count(distinct ${schema.productVariants.productId})::int` })
      .from(schema.productVariants)
      .innerJoin(schema.products, eq(schema.products.id, schema.productVariants.productId))
      .where(
        and(
          isNull(schema.productVariants.archivedAt),
          isNull(schema.products.archivedAt),
          eq(schema.products.isActive, true),
          sql`${schema.productVariants.stock} <= ${schema.products.lowStockThreshold}`,
        ),
      );
    const [waiting] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.conversations)
      .where(
        and(eq(schema.conversations.status, 'open'), eq(schema.conversations.needsAttention, true)),
      );
    return insertAlert(tx, businessId, {
      kind: 'briefing',
      key,
      to: settings.ownerWhatsapp,
      params: [
        label,
        business.name,
        formatNaira(sales?.total ?? 0),
        String(sales?.n ?? 0),
        String(unpaid?.n ?? 0),
        formatNaira(unpaid?.total ?? 0),
        String(toSend?.n ?? 0),
        String(low?.n ?? 0),
        String(waiting?.n ?? 0),
        dashboardUrl('/'),
      ],
    });
  });
}

// ─── Sending (worker) ────────────────────────────────────────────────────────

/**
 * Alerts waiting to be sent. Ones still waiting after a day (template never approved) are
 * given up with a reason, so the owner sees why.
 */
export async function alertsToSend(businessId: string, now = new Date()): Promise<string[]> {
  return withTenant(businessId, async (tx) => {
    await tx
      .update(oa)
      .set({
        status: 'not_sent',
        error: "WhatsApp hasn't approved Fulcra's alert messages yet.",
      })
      .where(
        and(eq(oa.status, 'pending'), lt(oa.createdAt, new Date(now.getTime() - LOOKBACK_MS))),
      );
    const rows = await tx
      .select({ id: oa.id })
      .from(oa)
      .where(eq(oa.status, 'pending'))
      .orderBy(oa.createdAt)
      .limit(50);
    return rows.map((r) => r.id);
  });
}

export type AlertDelivery =
  | {
      status: 'ready';
      to: string;
      accountId: string;
      credentials: string;
      template: { name: string; language: string; params: string[] };
      text: string;
    }
  | { status: 'waiting' | 'not_configured' | 'skipped' };

/**
 * What the worker needs to send one alert from Fulcra's number. Without Fulcra's number set
 * up, the alert is kept as "not sent" with the reason (and still listed for the owner).
 */
export async function claimOwnerAlert(businessId: string, alertId: string): Promise<AlertDelivery> {
  const id = z.uuid().parse(alertId);
  const [alert] = await withTenant(businessId, (tx) =>
    tx.select().from(oa).where(eq(oa.id, id)).limit(1),
  );
  if (!alert || alert.status !== 'pending') return { status: 'skipped' };
  const platform = platformWhatsApp();
  if (!platform) {
    await markOwnerAlertFailed(
      businessId,
      id,
      "Fulcra's WhatsApp number is not set up yet, so this alert was not sent.",
      'not_sent',
    );
    return { status: 'not_configured' };
  }
  const template = await approvedPlatformTemplate(alert.kind as AlertKind);
  if (!template) return { status: 'waiting' };
  return {
    status: 'ready',
    to: alert.toPhone.replace(/^\+/, ''),
    accountId: platform.phoneNumberId,
    credentials: platform.credentials,
    template: { name: template.name, language: template.language, params: alert.params },
    text: alert.text,
  };
}

export async function markOwnerAlertSent(
  businessId: string,
  alertId: string,
  externalId: string,
): Promise<void> {
  await withTenant(businessId, (tx) =>
    tx
      .update(oa)
      .set({ status: 'sent', externalId, error: null })
      .where(and(eq(oa.id, alertId), eq(oa.status, 'pending'))),
  );
}

export async function markOwnerAlertFailed(
  businessId: string,
  alertId: string,
  error: string,
  status: 'failed' | 'not_sent' = 'failed',
): Promise<void> {
  await withTenant(businessId, (tx) =>
    tx
      .update(oa)
      .set({ status, error: error.slice(0, 500) })
      .where(eq(oa.id, alertId)),
  );
}

const ORDER = { pending: 0, sent: 1, delivered: 2, read: 3 } as const;

/**
 * A delivery update for a message from Fulcra's number. The alert is found by WhatsApp's id
 * (system access, 0003); its cost is logged against the business it was for (rule 12).
 */
export async function applyOwnerAlertStatus(update: {
  externalId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  error?: string;
  pricing?: { billable: boolean; category: string };
}): Promise<'updated' | 'unchanged' | 'not_found'> {
  const [found] = await withSystem((tx) =>
    tx
      .select({ id: oa.id, businessId: oa.businessId })
      .from(oa)
      .where(eq(oa.externalId, update.externalId))
      .limit(1),
  );
  if (!found) return 'not_found';
  if (update.pricing?.billable) {
    await recordWhatsAppUsage(found.businessId, {
      reference: update.externalId,
      category: update.pricing.category,
      feature: 'owner_alert',
    });
  }
  return withTenant(found.businessId, async (tx) => {
    const [alert] = await tx.select().from(oa).where(eq(oa.id, found.id)).for('update').limit(1);
    if (!alert) return 'not_found';
    if (update.status === 'failed') {
      if (alert.status === 'read' || alert.status === 'failed') return 'unchanged';
      await tx
        .update(oa)
        .set({ status: 'failed', error: update.error ?? 'Not delivered.' })
        .where(eq(oa.id, alert.id));
      return 'updated';
    }
    const current = ORDER[alert.status as keyof typeof ORDER];
    if (current === undefined || current >= ORDER[update.status]) return 'unchanged';
    await tx.update(oa).set({ status: update.status }).where(eq(oa.id, alert.id));
    return 'updated';
  });
}

// ─── For the owner ───────────────────────────────────────────────────────────

export type OwnerAlertView = Pick<
  schema.OwnerAlert,
  'id' | 'kind' | 'text' | 'status' | 'error' | 'createdAt'
>;

/** The latest alerts and briefings, newest first. */
export async function listRecentOwnerAlerts(actor: ActorContext): Promise<OwnerAlertView[]> {
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, ['owner', 'staff']);
    return tx
      .select({
        id: oa.id,
        kind: oa.kind,
        text: oa.text,
        status: oa.status,
        error: oa.error,
        createdAt: oa.createdAt,
      })
      .from(oa)
      .orderBy(desc(oa.createdAt))
      .limit(20);
  });
}

/** Sends a test alert to the owner's number now (owner only). */
export async function sendTestAlert(actor: ActorContext): Promise<void> {
  await withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, ['owner']);
    const [row] = await tx.select().from(schema.ownerNotificationSettings).limit(1);
    if (!row?.ownerWhatsapp)
      throw new CoreError('validation', 'Save your WhatsApp number first.', 'ownerWhatsapp');
    const [business] = await tx
      .select({ name: schema.businesses.name })
      .from(schema.businesses)
      .limit(1);
    await insertAlert(tx, actor.businessId, {
      kind: 'test',
      key: `test:${randomUUID()}`,
      to: row.ownerWhatsapp,
      params: [business?.name ?? ''],
    });
  });
  await enqueueOwnerAlertsNow();
}
