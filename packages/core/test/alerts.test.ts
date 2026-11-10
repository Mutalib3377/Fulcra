import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as QueueModule from '../src/jobs/queue';

const alertRuns: string[] = [];
vi.mock('../src/jobs/queue', async (original) => ({
  ...(await original<typeof QueueModule>()),
  enqueueSendMessage: async () => {},
  enqueueSubmitTemplates: async () => {},
  enqueueOwnerAlertsNow: async () => {
    alertRuns.push('now');
  },
}));

const { schema, withSystem, withTenant } = await import('@fulcra/db');
const { eq } = await import('drizzle-orm');
const al = await import('../src/alerts/alerts');
const pf = await import('../src/alerts/platform');
const st = await import('../src/alerts/settings');
const { recordEvent } = await import('../src/events/events');
const { createOrder, markOrderPaid } = await import('../src/orders/orders');
const { addMember, newBusiness, shopWithStock } = await import('./helpers');

const PLATFORM = {
  FULCRA_WHATSAPP_PHONE_NUMBER_ID: '999000111222333',
  FULCRA_WHATSAPP_BUSINESS_ACCOUNT_ID: '999000111222000',
  FULCRA_WHATSAPP_ACCESS_TOKEN: 'EAAplatform-token',
};
const setPlatform = (on: boolean) => {
  for (const [k, v] of Object.entries(PLATFORM)) {
    if (on) process.env[k] = v;
    else delete process.env[k];
  }
};
afterEach(() => setPlatform(false));

/** Fulcra's alert templates, submitted and approved (shared by all businesses). */
async function approvePlatformTemplates() {
  setPlatform(true);
  await pf.ensurePlatformTemplates();
  for (const t of await pf.platformTemplatesToSubmit())
    await pf.savePlatformTemplateSubmission(t.id, { externalId: `p-${t.name}`, status: 'PENDING' });
  const rows = await withSystem((tx) => tx.select().from(schema.platformTemplates));
  for (const t of rows)
    await pf.applyPlatformTemplateStatus({
      businessAccountId: PLATFORM.FULCRA_WHATSAPP_BUSINESS_ACCOUNT_ID,
      externalId: t.externalId ?? undefined,
      name: t.name,
      status: 'APPROVED',
    });
}

beforeAll(async () => {
  await pf.ensurePlatformTemplates();
});

const alertsOf = (businessId: string) =>
  withTenant(businessId, (tx) =>
    tx.select().from(schema.ownerAlerts).orderBy(schema.ownerAlerts.createdAt),
  );

describe('alert settings', () => {
  it('defaults, phone normalised, owner only', async () => {
    const shop = await newBusiness('alerts');
    expect(await st.getOwnerAlertSettings(shop.actor)).toEqual(st.OWNER_ALERT_DEFAULTS);
    const saved = await st.saveOwnerAlertSettings(shop.actor, {
      ownerWhatsapp: '0803 123 4567',
      alertLowStock: false,
      briefingTime: '07:30',
    });
    expect(saved).toMatchObject({
      ownerWhatsapp: '+2348031234567',
      alertLowStock: false,
      alertPaidOrders: true,
      briefingTime: '07:30',
      customerMessagesEnabled: true,
    });
    await expect(st.saveOwnerAlertSettings(shop.actor, { ownerWhatsapp: '12' })).rejects.toThrow(
      'Enter a phone number',
    );
    await expect(
      st.saveOwnerAlertSettings(shop.actor, { briefingTime: '25:00' }),
    ).rejects.toThrow();
    const staff = await addMember(shop.actor, 'staff');
    await expect(st.saveOwnerAlertSettings(staff, { ownerWhatsapp: '' })).rejects.toThrow();
    expect((await st.getOwnerAlertSettings(staff)).ownerWhatsapp).toBe('+2348031234567');
    const rider = await addMember(shop.actor, 'rider');
    await expect(st.getOwnerAlertSettings(rider)).rejects.toThrow();
  });
});

describe('alerts from events', () => {
  it('paid order, low stock, payment to check and a chat passed by the assistant: once each', async () => {
    const shop = await shopWithStock(4);
    // Nothing before the owner set up alerts.
    await recordEventNow(shop.business.id, 'payment.unmatched', { amount: 500_000 });
    await new Promise((r) => setTimeout(r, 20));
    await st.saveOwnerAlertSettings(shop.actor, { ownerWhatsapp: '0803 123 4567' });

    const { order } = await createOrder(shop.actor, {
      customer: { name: 'Chioma Obi', phone: '0805 111 2222' },
      items: [{ variantId: shop.variant.id, quantity: 2 }],
      fulfilment: 'pickup',
    }); // stock 4 → 2: low (warning level 3)
    await markOrderPaid(shop.actor, order.id, { method: 'cash' });
    await recordEventNow(shop.business.id, 'payment.unmatched', { amount: 1_250_000 });
    const conversationId = randomUUID();
    await recordEventNow(
      shop.business.id,
      'conversation.handoff',
      { conversationId, to: 'human', reason: 'Customer asked for a person' },
      'agent',
      order.customerId,
    );
    // The team taking over a chat is not an alert.
    await recordEventNow(shop.business.id, 'conversation.handoff', {
      conversationId,
      to: 'human',
      reason: 'taken_over',
    });

    expect(await al.createPendingAlerts(shop.business.id)).toBe(4);
    expect(await al.createPendingAlerts(shop.business.id)).toBe(0);
    const alerts = await alertsOf(shop.business.id);
    expect(alerts.map((a) => a.kind).sort()).toEqual([
      'low_stock',
      'paid_order',
      'unmatched_payment',
      'waiting_customer',
    ]);
    expect(alerts.every((a) => a.toPhone === '+2348031234567' && a.status === 'pending')).toBe(
      true,
    );
    const paid = alerts.find((a) => a.kind === 'paid_order')!;
    expect(paid.text).toBe(
      `New paid order #${order.orderNumber} at ${shop.business.name}: ₦30,000.00 from Chioma Obi. See it here: ${paid.params[4]} (Fulcra alert)`,
    );
    expect(paid.params[4]).toMatch(new RegExp(`^https?://app\\..+/orders/${order.id}$`));
    expect(alerts.find((a) => a.kind === 'low_stock')!.text).toContain('Ankara dress has 2 left');
    expect(alerts.find((a) => a.kind === 'unmatched_payment')!.text).toContain('₦12,500.00');
    expect(alerts.find((a) => a.kind === 'waiting_customer')!.text).toContain(
      'Chioma Obi is waiting for a reply',
    );

    // Switched off: no more low-stock alerts.
    await st.saveOwnerAlertSettings(shop.actor, {
      ownerWhatsapp: '0803 123 4567',
      alertLowStock: false,
    });
    await recordEventNow(shop.business.id, 'stock.low', { productName: 'Bag', stock: 1 });
    expect(await al.createPendingAlerts(shop.business.id)).toBe(0);
  });

  it('nothing without the owner number', async () => {
    const shop = await newBusiness('alerts-none');
    await recordEventNow(shop.business.id, 'payment.unmatched', { amount: 100 });
    expect(await al.createPendingAlerts(shop.business.id)).toBe(0);
    expect(await al.businessesWithAlerts()).not.toContain(shop.business.id);
  });
});

describe('sending alerts', () => {
  it('without Fulcra’s number the alert is kept as not sent, with the reason', async () => {
    const shop = await newBusiness('alerts-off');
    await st.saveOwnerAlertSettings(shop.actor, { ownerWhatsapp: '0803 123 4567' });
    await al.sendTestAlert(shop.actor);
    expect(alertRuns.length).toBeGreaterThan(0);
    const [id] = await al.alertsToSend(shop.business.id);
    expect(await al.claimOwnerAlert(shop.business.id, id!)).toEqual({ status: 'not_configured' });
    const [alert] = await al.listRecentOwnerAlerts(shop.actor);
    expect(alert).toMatchObject({
      kind: 'test',
      status: 'not_sent',
      error: expect.stringContaining('not set up yet'),
    });
  });

  it('sends with the approved template; ticks and cost from delivery updates', async () => {
    const shop = await newBusiness('alerts-on');
    await st.saveOwnerAlertSettings(shop.actor, { ownerWhatsapp: '0803 123 4567' });
    await expect(al.sendTestAlert(await addMember(shop.actor, 'staff'))).rejects.toThrow();
    await al.sendTestAlert(shop.actor);
    await approvePlatformTemplates();
    const [id] = await al.alertsToSend(shop.business.id);
    const delivery = await al.claimOwnerAlert(shop.business.id, id!);
    expect(delivery).toMatchObject({
      status: 'ready',
      to: '2348031234567',
      accountId: PLATFORM.FULCRA_WHATSAPP_PHONE_NUMBER_ID,
      template: { name: 'fulcra_alert_test_v1', language: 'en', params: [shop.business.name] },
      text: `Hello, this is a test alert from Fulcra for ${shop.business.name}. Your WhatsApp alerts are working.`,
    });
    expect(JSON.parse((delivery as { credentials: string }).credentials)).toEqual({
      accessToken: PLATFORM.FULCRA_WHATSAPP_ACCESS_TOKEN,
    });
    const wamid = `wamid.alert-${randomUUID()}`;
    await al.markOwnerAlertSent(shop.business.id, id!, wamid);
    expect(await al.alertsToSend(shop.business.id)).toEqual([]);

    const priced = { billable: true, category: 'utility' };
    expect(
      await al.applyOwnerAlertStatus({ externalId: wamid, status: 'delivered', pricing: priced }),
    ).toBe('updated');
    expect(
      await al.applyOwnerAlertStatus({ externalId: wamid, status: 'read', pricing: priced }),
    ).toBe('updated');
    expect(await al.applyOwnerAlertStatus({ externalId: wamid, status: 'delivered' })).toBe(
      'unchanged',
    );
    expect(await al.applyOwnerAlertStatus({ externalId: 'wamid.other', status: 'read' })).toBe(
      'not_found',
    );
    const [alert] = await al.listRecentOwnerAlerts(shop.actor);
    expect(alert!.status).toBe('read');
    const usage = await withTenant(shop.business.id, (tx) => tx.select().from(schema.usageRecords));
    expect(usage.map((u) => [u.kind, u.feature, u.costUsd])).toEqual([
      ['whatsapp_message', 'owner_alert.utility', 0.0101],
    ]);

    const other = await newBusiness('alerts-other');
    expect(await al.listRecentOwnerAlerts(other.actor)).toEqual([]);
  });

  it('alerts still waiting after a day are given up with a reason', async () => {
    const shop = await newBusiness('alerts-old');
    await st.saveOwnerAlertSettings(shop.actor, { ownerWhatsapp: '0803 123 4567' });
    await al.sendTestAlert(shop.actor);
    const later = new Date(Date.now() + 25 * 3_600_000);
    expect(await al.alertsToSend(shop.business.id, later)).toEqual([]);
    const [alert] = await al.listRecentOwnerAlerts(shop.actor);
    expect(alert).toMatchObject({ status: 'not_sent', error: expect.stringContaining('approved') });
  });
});

describe('daily briefing', () => {
  it('once a day after the chosen time: yesterday’s sales and what is waiting now', async () => {
    const shop = await shopWithStock(2);
    await st.saveOwnerAlertSettings(shop.actor, {
      ownerWhatsapp: '0803 123 4567',
      briefingTime: '08:00',
    });
    const { order } = await createOrder(shop.actor, {
      customer: { name: 'Chioma Obi', phone: '0805 111 2222' },
      items: [{ variantId: shop.variant.id, quantity: 1 }],
      fulfilment: 'pickup',
    });
    await markOrderPaid(shop.actor, order.id, { method: 'cash' });
    await createOrder(shop.actor, {
      customer: { name: 'Bola', phone: '0805 333 4444' },
      items: [{ variantId: shop.variant.id, quantity: 1 }],
      fulfilment: 'pickup',
    });
    // Lagos is UTC+1: 07:30 local is before the time; 09:00 local is after.
    const day = new Date();
    const lagosDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(day);
    const at = (hhmm: string) => new Date(`${lagosDate}T${hhmm}:00+01:00`);
    await withTenant(shop.business.id, (tx) =>
      tx
        .update(schema.orders)
        .set({ paidAt: new Date(at('12:00').getTime() - 86_400_000) })
        .where(eq(schema.orders.id, order.id)),
    );
    expect(await al.createBriefingIfDue(shop.business.id, at('07:30'))).toBeNull();
    const id = await al.createBriefingIfDue(shop.business.id, at('09:00'));
    expect(id).not.toBeNull();
    expect(await al.createBriefingIfDue(shop.business.id, at('10:00'))).toBeNull();
    const briefing = (await alertsOf(shop.business.id)).find((a) => a.kind === 'briefing')!;
    expect(briefing.params.slice(1, 9)).toEqual([
      shop.business.name,
      '₦15,000.00',
      '1',
      '1',
      '₦15,000.00',
      '1',
      '1',
      '0',
    ]);
    expect(briefing.text.startsWith('Good morning! Yesterday (')).toBe(true);
    expect(briefing.dedupeKey).toBe(`briefing:${lagosDate}`);

    await st.saveOwnerAlertSettings(shop.actor, {
      ownerWhatsapp: '0803 123 4567',
      briefingEnabled: false,
    });
    const tomorrow = new Date(at('09:00').getTime() + 86_400_000);
    expect(await al.createBriefingIfDue(shop.business.id, tomorrow)).toBeNull();
  });
});

async function recordEventNow(
  businessId: string,
  type: Parameters<typeof recordEvent>[2]['type'],
  payload: Record<string, unknown>,
  actor: 'system' | 'agent' = 'system',
  customerId: string | null = null,
) {
  await withTenant(businessId, (tx) =>
    recordEvent(tx, businessId, { type, actor: { type: actor }, customerId, payload }),
  );
}
