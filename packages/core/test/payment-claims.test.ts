import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as QueueModule from '../src/jobs/queue';

vi.mock('../src/jobs/queue', async (original) => ({
  ...(await original<typeof QueueModule>()),
  enqueueSendMessage: async () => {},
}));

const { schema, withTenant } = await import('@fulcra/db');
const { eq } = await import('drizzle-orm');
const { listEvents } = await import('../src/events/events');
const { setPaystackClient } = await import('../src/payments/paystack');
const { savePayoutAccount } = await import('../src/payments/payout');
const { receiveInboundMessage } = await import('../src/conversations/conversations');
const a = await import('../src/agent/assistant');
const { saveAgentSettings } = await import('../src/agent/settings');
const { savePhotoDescription } = await import('../src/agent/photos');
const { markOrderPaid, cancelOrder } = await import('../src/orders/orders');
const { businessesWithOpenClaims, sweepPaymentClaims } = await import('../src/payments/claims');
const { claimFlags, normalizeReference, parseReceiptTime } =
  await import('../src/payments/claim-rules');
const { FakePaystack } = await import('../src/testing/fake-paystack');
const { shopWithStock } = await import('./helpers');

beforeEach(() => setPaystackClient(new FakePaystack()));
afterEach(() => setPaystackClient(null));

const MIN = 60_000;
const later = (minutes: number) => new Date(Date.now() + minutes * MIN);

/** A shop with the assistant on, a ₦15,000 dress and a WhatsApp chat with Chioma. */
async function shop() {
  const s = await shopWithStock(10);
  await savePayoutAccount(s.actor, { bankCode: '058', accountNumber: '0123456789' });
  await saveAgentSettings(s.actor, { enabled: true });
  const b = s.business.id;
  const connection = await withTenant(b, async (tx) => {
    const [row] = await tx
      .insert(schema.channelConnections)
      .values({ businessId: b, channel: 'whatsapp', externalAccountId: `pn-${randomUUID()}` })
      .returning();
    return row!;
  });
  const say = (text: string, from = '2348031234567') =>
    receiveInboundMessage(b, connection.id, {
      externalId: `wamid.${randomUUID()}`,
      from: { externalUserId: from, displayName: 'Chioma' },
      sentAt: new Date().toISOString(),
      type: 'text',
      text,
    }) as Promise<{ conversationId: string; messageId: string }>;
  /** Chioma orders `quantity` dresses for pickup (₦15,000 each). */
  const order = async (conversationId: string, quantity = 1) =>
    a.assistantCreateOrder(b, conversationId, {
      items: [{ variantId: s.variant.id, quantity }],
      fulfilment: 'pickup',
      deliveryZoneId: null,
      deliveryAddress: '',
    });
  const screenshot = async (
    payment: { amountNaira: number | null; reference?: string; dateTime?: string },
    from?: string,
  ) => {
    const m = await say('I don pay', from);
    await savePhotoDescription(b, m.messageId, {
      kind: 'payment_proof',
      description: 'A bank transfer receipt.',
      textInPhoto: 'Transfer successful',
      searchTerms: [],
      payment: { bank: 'Opay', senderName: 'Chioma Obi', reference: '', dateTime: '', ...payment },
    });
    return m;
  };
  const claims = () =>
    withTenant(b, (tx) =>
      tx.select().from(schema.paymentClaims).orderBy(schema.paymentClaims.createdAt),
    );
  const orderId = async (n: number) => {
    const [row] = await withTenant(b, (tx) =>
      tx.select().from(schema.orders).where(eq(schema.orders.orderNumber, n)),
    );
    return row!.id;
  };
  return { ...s, b, say, order, screenshot, claims, orderId };
}

describe('claim rules', () => {
  it('reads receipt times as Lagos time and rejects impossible dates', () => {
    expect(parseReceiptTime('2026-11-18T15:42')).toEqual({
      at: new Date('2026-11-18T14:42:00Z'),
      hasTime: true,
    });
    expect(parseReceiptTime('2026-11-18')?.hasTime).toBe(false);
    expect(parseReceiptTime('2026-02-31')).toBeNull();
    expect(parseReceiptTime('yesterday')).toBeNull();
    expect(normalizeReference(' 1000-04 2611 18ab ')).toBe('100004261118AB');
    expect(normalizeReference('12-34')).toBeNull();
  });

  it('flags amounts that differ, receipts before the order or in the future, reused receipts', () => {
    const now = new Date('2026-11-18T15:00:00Z');
    const order = { total: 1_700_000, amountPaid: 0, createdAt: new Date('2026-11-18T14:00:00Z') };
    const base = {
      claimedAmount: 1_700_000,
      receipt: null,
      order,
      referenceUsedElsewhere: false,
      now,
    };
    expect(claimFlags(base)).toEqual([]);
    expect(claimFlags({ ...base, claimedAmount: 1_500_000 })).toEqual(['amount_mismatch']);
    // What is still owed after a part payment is fine too.
    expect(
      claimFlags({ ...base, claimedAmount: 700_000, order: { ...order, amountPaid: 1_000_000 } }),
    ).toEqual([]);
    expect(claimFlags({ ...base, receipt: parseReceiptTime('2026-11-18T13:00') })).toEqual([
      'dated_before_order',
    ]);
    // Within half an hour before the order is allowed.
    expect(claimFlags({ ...base, receipt: parseReceiptTime('2026-11-18T14:45') })).toEqual([]);
    expect(claimFlags({ ...base, receipt: parseReceiptTime('2026-11-17') })).toEqual([
      'dated_before_order',
    ]);
    expect(claimFlags({ ...base, receipt: parseReceiptTime('2026-11-18T17:30') })).toEqual([
      'future_date',
    ]);
    expect(claimFlags({ ...base, referenceUsedElsewhere: true })).toEqual(['reused_reference']);
  });
});

describe('payment claims', () => {
  it('a screenshot with no money: waits, then "not received" after 20 minutes, then clears when paid', async () => {
    const s = await shop();
    const { conversationId } = await s.say('I want the dress');
    await s.order(conversationId);
    const m = await s.screenshot({ amountNaira: 15_000, reference: 'S-100004261118' });

    const [claim] = await s.claims();
    expect(claim).toMatchObject({
      source: 'screenshot',
      status: 'waiting',
      messageId: m.messageId,
      orderId: await s.orderId(1001),
      claimedAmount: 1_500_000,
      bank: 'Opay',
      senderName: 'Chioma Obi',
      reference: 'S100004261118',
      flags: [],
    });
    // The same message never makes two claims.
    await savePhotoDescription(s.b, m.messageId, {
      kind: 'payment_proof',
      description: 'A receipt.',
      textInPhoto: '',
      searchTerms: [],
      payment: { amountNaira: 15_000, bank: '', senderName: '', reference: '', dateTime: '' },
    });
    expect(await s.claims()).toHaveLength(1);

    // The assistant sees the claim and is told not to call it paid.
    const status = await a.assistantOrderStatus(s.b, conversationId, 1001);
    expect(status.orders[0]).toMatchObject({
      paid: false,
      paymentClaim: { status: 'waiting', screenshotAmount: '₦15,000.00' },
    });
    expect(status.orders[0]!.paymentClaim!.note).toMatch(/Do not say it is paid/);

    expect(await businessesWithOpenClaims()).toContain(s.b);
    expect(await sweepPaymentClaims(s.b, later(5))).toEqual({
      confirmed: 0,
      notReceived: 0,
      closed: 0,
    });
    expect(await sweepPaymentClaims(s.b, later(21))).toMatchObject({ notReceived: 1 });
    expect((await s.claims())[0]).toMatchObject({ status: 'not_received' });
    const unverified = (await listEvents(s.actor)).find(
      (e) => e.type === 'payment.claim_unverified',
    );
    expect(unverified).toMatchObject({
      actorType: 'system',
      payload: { claimId: claim!.id, amount: 1_500_000, source: 'screenshot', conversationId },
    });
    // Only once.
    expect(await sweepPaymentClaims(s.b, later(22))).toMatchObject({ notReceived: 0 });

    // The money lands later (the owner checked and marked it paid): cleared.
    await markOrderPaid(s.actor, await s.orderId(1001), { method: 'transfer' });
    expect(await sweepPaymentClaims(s.b, later(30))).toMatchObject({ confirmed: 1 });
    expect((await s.claims())[0]).toMatchObject({ status: 'confirmed', receivedAmount: 1_500_000 });
    expect((await listEvents(s.actor)).map((e) => e.type)).toContain('payment.claim_cleared');
    expect(await businessesWithOpenClaims()).not.toContain(s.b);
  });

  it('money arriving in time confirms the claim with no warning', async () => {
    const s = await shop();
    const { conversationId } = await s.say('I want it');
    await s.order(conversationId);
    await s.screenshot({ amountNaira: 15_000 });
    await markOrderPaid(s.actor, await s.orderId(1001), { method: 'transfer' });
    expect(await sweepPaymentClaims(s.b, later(2))).toMatchObject({ confirmed: 1 });
    expect(await sweepPaymentClaims(s.b, later(25))).toMatchObject({ notReceived: 0 });
    expect((await listEvents(s.actor)).map((e) => e.type)).not.toContain(
      'payment.claim_unverified',
    );
  });

  it('"I have paid" without a screenshot: one claim per order, upgraded by a later screenshot', async () => {
    const s = await shop();
    const { conversationId } = await s.say('I want it');
    await s.order(conversationId);
    const first = await a.assistantOrderStatus(s.b, conversationId, 1001, true);
    expect(first.orders[0]).toMatchObject({ paymentClaim: { status: 'waiting' } });
    await a.assistantOrderStatus(s.b, conversationId, 1001, true);
    expect(await s.claims()).toMatchObject([{ source: 'customer_said', claimedAmount: null }]);

    // A screenshot now fills in the same claim.
    await s.screenshot({ amountNaira: 12_000 });
    const [claim, ...rest] = await s.claims();
    expect(rest).toEqual([]);
    expect(claim).toMatchObject({
      source: 'screenshot',
      claimedAmount: 1_200_000,
      flags: ['amount_mismatch'],
    });
    const status = await a.assistantOrderStatus(s.b, conversationId, 1001);
    expect(status.orders[0]!.paymentClaim!.note).toMatch(
      /screenshot shows ₦12,000.00, but the order still needs ₦15,000.00/,
    );

    // Saying "paid" about an order that is paid makes no claim.
    const { conversationId: c2 } = await s.say('another one', '2348039999999');
    await s.order(c2);
    await markOrderPaid(s.actor, await s.orderId(1002), { method: 'cash' });
    await a.assistantOrderStatus(s.b, c2, 1002, true);
    expect(await s.claims()).toHaveLength(1);
  });

  it('a screenshot goes to the unpaid order it pays exactly', async () => {
    const s = await shop();
    const { conversationId } = await s.say('I want two orders');
    await s.order(conversationId, 1); // ₦15,000
    await s.order(conversationId, 2); // ₦30,000 (newest)
    await s.screenshot({ amountNaira: 15_000 });
    expect((await s.claims())[0]!.orderId).toBe(await s.orderId(1001));
  });

  it('flags a receipt reference already used for another customer', async () => {
    const s = await shop();
    const { conversationId } = await s.say('I want it');
    await s.order(conversationId);
    await s.screenshot({ amountNaira: 15_000, reference: '000013261118094512' });
    const other = await s.say('I want it too', '2348030000001');
    await s.order(other.conversationId);
    await s.screenshot(
      { amountNaira: 15_000, reference: '0000-1326-1118-0945-12' },
      '2348030000001',
    );
    const [first, second] = await s.claims();
    expect(first!.flags).toEqual([]);
    expect(second!.flags).toEqual(['reused_reference']);
  });

  it('no warning while a transfer from the customer waits for the owner to match it', async () => {
    const s = await shop();
    const { conversationId } = await s.say('I want it');
    await s.order(conversationId);
    await s.screenshot({ amountNaira: 14_000 });
    const [claim] = await s.claims();
    await withTenant(s.b, (tx) =>
      tx.insert(schema.payments).values({
        businessId: s.b,
        customerId: claim!.customerId,
        provider: 'paystack',
        reference: `trf-${randomUUID()}`,
        amount: 1_400_000,
        status: 'unmatched',
      }),
    );
    expect(await sweepPaymentClaims(s.b, later(25))).toMatchObject({ notReceived: 0 });
    expect((await s.claims())[0]!.status).toBe('waiting');
  });

  it('a screenshot with no order is confirmed by a payment from that customer', async () => {
    const s = await shop();
    await s.screenshot({ amountNaira: 5_000 });
    const [claim] = await s.claims();
    expect(claim).toMatchObject({ orderId: null, status: 'waiting', flags: [] });
    await withTenant(s.b, (tx) =>
      tx.insert(schema.payments).values({
        businessId: s.b,
        customerId: claim!.customerId,
        provider: 'paystack',
        reference: `trf-${randomUUID()}`,
        amount: 500_000,
        status: 'success',
        paidAt: new Date(),
      }),
    );
    expect(await sweepPaymentClaims(s.b, later(1))).toMatchObject({ confirmed: 1 });
    expect((await s.claims())[0]).toMatchObject({ status: 'confirmed', receivedAmount: 500_000 });
  });

  it('a claim for a cancelled order is closed quietly', async () => {
    const s = await shop();
    const { conversationId } = await s.say('I want it');
    await s.order(conversationId);
    await s.screenshot({ amountNaira: 15_000 });
    await cancelOrder(s.actor, await s.orderId(1001), { reason: 'Customer changed mind' });
    expect(await sweepPaymentClaims(s.b, later(25))).toMatchObject({ closed: 1, notReceived: 0 });
    expect((await s.claims())[0]!.status).toBe('dismissed');
  });

  it('claims stay inside their business', async () => {
    const s = await shop();
    await s.screenshot({ amountNaira: 5_000 });
    const other = await shop();
    expect(await other.claims()).toEqual([]);
    expect(await sweepPaymentClaims(other.b, later(25))).toEqual({
      confirmed: 0,
      notReceived: 0,
      closed: 0,
    });
    expect((await s.claims())[0]!.status).toBe('waiting');
  });
});
