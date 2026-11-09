import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getOrder, markOrderPaid, cancelOrder, createOrder } from '../src/orders/orders';
import { listEvents } from '../src/events/events';
import { setPaystackClient } from '../src/payments/paystack';
import {
  clearBankCache,
  getPayoutSettings,
  listBanks,
  resolveBankAccount,
  savePayoutAccount,
} from '../src/payments/payout';
import {
  createPaymentLink,
  listOrderPayments,
  processPaystackWebhook,
  recordPaystackWebhook,
} from '../src/payments/payments';
import { getReceipt } from '../src/payments/receipts';
import { FakePaystack, signedWebhook, TEST_SECRET } from '../src/testing/fake-paystack';
import { addMember, shopWithStock } from './helpers';

let paystack: FakePaystack;
const originalKey = process.env.PAYSTACK_SECRET_KEY;

beforeEach(() => {
  paystack = new FakePaystack();
  setPaystackClient(paystack);
  clearBankCache();
  process.env.PAYSTACK_SECRET_KEY = TEST_SECRET;
});
afterEach(() => {
  setPaystackClient(null);
  if (originalKey === undefined) delete process.env.PAYSTACK_SECRET_KEY;
  else process.env.PAYSTACK_SECRET_KEY = originalKey;
});

/** A shop with payouts set up and one ₦15,000 pickup order. */
async function shopWithOrder() {
  const shop = await shopWithStock(5);
  await savePayoutAccount(shop.actor, { bankCode: '058', accountNumber: '0123456789' });
  const { order } = await createOrder(shop.actor, {
    customer: { name: 'Ngozi', phone: '08035550101' },
    items: [{ variantId: shop.variant.id, quantity: 1 }],
    fulfilment: 'pickup',
  });
  return { ...shop, order };
}

/** Simulates Paystack calling our webhook, then the worker processing it. */
let nextTransactionId = Date.now();
async function deliverWebhook(reference: string, transactionId = nextTransactionId++) {
  const { body, signature } = signedWebhook('charge.success', {
    id: transactionId,
    reference,
    amount: 1,
  });
  const saved = await recordPaystackWebhook(body, signature);
  return {
    saved,
    processed: saved.status === 'saved' ? await processPaystackWebhook(saved.webhookEventId) : null,
  };
}

describe('payout setup', () => {
  it('owner saves a bank account: subaccount created, details shown, update reuses it', async () => {
    const { actor } = await shopWithStock(1);
    expect(await getPayoutSettings(actor)).toMatchObject({ configured: false });
    expect((await listBanks()).map((b) => b.name)).toEqual(['Access Bank', 'Guaranty Trust Bank']);
    expect(
      await resolveBankAccount(actor, { bankCode: '058', accountNumber: '0123456789' }),
    ).toEqual({ accountName: 'ADA STYLES ENTERPRISES' });

    const saved = await savePayoutAccount(actor, { bankCode: '058', accountNumber: '0123456789' });
    expect(saved).toEqual({
      configured: true,
      bankName: 'Guaranty Trust Bank',
      accountName: 'ADA STYLES ENTERPRISES',
      accountLast4: '6789',
    });
    await savePayoutAccount(actor, { bankCode: '044', accountNumber: '9876543210' });
    expect(paystack.subaccounts.size).toBe(1);
    expect(await getPayoutSettings(actor)).toMatchObject({
      bankName: 'Access Bank',
      accountLast4: '3210',
    });
  });

  it('rejects bad accounts and non-owners', async () => {
    const { actor } = await shopWithStock(1);
    await expect(
      savePayoutAccount(actor, { bankCode: '058', accountNumber: '123' }),
    ).rejects.toThrow();
    await expect(
      savePayoutAccount(actor, { bankCode: '058', accountNumber: '0000000000' }),
    ).rejects.toMatchObject({ field: 'accountNumber' });
    const staff = await addMember(actor, 'staff');
    await expect(
      savePayoutAccount(staff, { bankCode: '058', accountNumber: '0123456789' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('payment links', () => {
  it('needs payout setup first', async () => {
    const { actor, variant } = await shopWithStock(5);
    const { order } = await createOrder(actor, {
      customer: { name: 'A' },
      items: [{ variantId: variant.id, quantity: 1 }],
      fulfilment: 'pickup',
    });
    await expect(createPaymentLink(actor, order.id)).rejects.toMatchObject({ field: 'payout' });
  });

  it('creates a checkout for the exact total, settled to the subaccount; reuses it; order awaits payment', async () => {
    const { actor, order } = await shopWithOrder();
    const link = await createPaymentLink(actor, order.id);
    expect(link).toMatchObject({
      reused: false,
      url: expect.stringContaining('checkout.paystack.com'),
    });
    expect(paystack.initialized[0]).toMatchObject({
      amount: 1_500_000,
      subaccount: 'ACCT_1',
      email: '2348035550101@customers.yourdomain.com',
      callbackUrl: expect.stringMatching(/\/receipt\/[0-9a-f]{32}$/),
    });
    expect((await getOrder(actor, order.id)).order.status).toBe('awaiting_payment');

    const again = await createPaymentLink(actor, order.id);
    expect(again).toMatchObject({ reused: true, url: link.url });
    expect(paystack.initialized).toHaveLength(1);
  });

  it('a Paystack failure leaves the order unchanged and the attempt marked failed', async () => {
    const { actor, order } = await shopWithOrder();
    paystack.failInitialize = true;
    await expect(createPaymentLink(actor, order.id)).rejects.toMatchObject({ code: 'conflict' });
    expect((await getOrder(actor, order.id)).order.status).toBe('new');
    expect((await listOrderPayments(actor, order.id))[0]).toMatchObject({ status: 'failed' });
  });

  it('refuses paid or cancelled orders', async () => {
    const { actor, order } = await shopWithOrder();
    await markOrderPaid(actor, order.id, { method: 'cash' });
    await expect(createPaymentLink(actor, order.id)).rejects.toMatchObject({ code: 'conflict' });
  });
});

describe('webhooks', () => {
  it('a confirmed payment marks the order paid, once, however many times Paystack calls', async () => {
    const { actor, order } = await shopWithOrder();
    const { reference } = await createPaymentLink(actor, order.id);

    const transactionId = nextTransactionId++;
    const first = await deliverWebhook(reference, transactionId);
    expect(first.processed).toBe('confirmed');
    // Paystack retries the same event: saved once, never counted twice.
    expect((await deliverWebhook(reference, transactionId)).saved).toMatchObject({
      status: 'duplicate',
      processed: true,
    });
    // A different event for the same payment (or a re-run of the job) changes nothing.
    expect((await deliverWebhook(reference)).processed).toBe('already_confirmed');
    if (first.saved.status === 'saved')
      expect(await processPaystackWebhook(first.saved.webhookEventId)).toBe('already_processed');

    const { order: paid } = await getOrder(actor, order.id);
    expect(paid).toMatchObject({
      status: 'paid',
      amountPaid: 1_500_000,
      paymentMethod: 'paystack',
    });
    const payments = await listOrderPayments(actor, order.id);
    expect(payments.filter((p) => p.status === 'success')).toHaveLength(1);
    expect(payments[0]).toMatchObject({ method: 'bank_transfer', provider: 'paystack' });
    expect(
      (await listEvents(actor, { orderId: order.id })).filter(
        (e) => e.type === 'payment.confirmed',
      ),
    ).toHaveLength(1);
  });

  it('two deliveries processed at the same time still count once', async () => {
    const { actor, order } = await shopWithOrder();
    const { reference } = await createPaymentLink(actor, order.id);
    const a = signedWebhook('charge.success', { id: nextTransactionId++, reference });
    const b = signedWebhook('charge.success', { id: nextTransactionId++, reference });
    const [ra, rb] = await Promise.all([
      recordPaystackWebhook(a.body, a.signature),
      recordPaystackWebhook(b.body, b.signature),
    ]);
    if (ra.status !== 'saved' || rb.status !== 'saved') throw new Error('expected both saved');
    const results = await Promise.all([
      processPaystackWebhook(ra.webhookEventId),
      processPaystackWebhook(rb.webhookEventId),
    ]);
    expect(results.sort()).toEqual(['already_confirmed', 'confirmed']);
    expect((await getOrder(actor, order.id)).order.amountPaid).toBe(1_500_000);
  });

  it('rejects bad signatures and ignores other events and unknown references', async () => {
    const { body } = signedWebhook('charge.success', { id: 1, reference: 'x' });
    expect(await recordPaystackWebhook(body, 'f'.repeat(128))).toEqual({
      status: 'invalid_signature',
    });
    expect(await recordPaystackWebhook(body, null)).toEqual({ status: 'invalid_signature' });

    const transfer = signedWebhook('transfer.success', { id: Date.now(), reference: 'tr_1' });
    const saved = await recordPaystackWebhook(transfer.body, transfer.signature);
    if (saved.status !== 'saved') throw new Error('expected saved');
    expect(await processPaystackWebhook(saved.webhookEventId)).toBe('ignored');

    expect((await deliverWebhook(`not-ours-${Date.now()}`)).processed).toBe('unknown_reference');
  });

  it('never trusts the webhook alone: a mismatched amount needs review, the order stays unpaid', async () => {
    const { actor, order } = await shopWithOrder();
    const { reference } = await createPaymentLink(actor, order.id);
    paystack.verifyResult.set(reference, { amount: 1_000_000 });
    expect((await deliverWebhook(reference)).processed).toBe('needs_review');
    expect((await getOrder(actor, order.id)).order.status).toBe('awaiting_payment');
    expect((await listOrderPayments(actor, order.id))[0]).toMatchObject({
      status: 'needs_review',
      reportedAmount: 1_000_000,
    });
    expect(
      (await listEvents(actor, { orderId: order.id })).some(
        (e) => e.type === 'payment.needs_review',
      ),
    ).toBe(true);
  });

  it('a payment Paystack has not confirmed is retried, not accepted', async () => {
    const { actor, order } = await shopWithOrder();
    const { reference } = await createPaymentLink(actor, order.id);
    paystack.verifyResult.set(reference, { status: 'pending' });
    await expect(deliverWebhook(reference)).rejects.toThrow(/pending/);
    expect((await getOrder(actor, order.id)).order.status).toBe('awaiting_payment');
  });

  it('money for a cancelled or already-paid order is flagged for review', async () => {
    const { actor, order } = await shopWithOrder();
    const { reference } = await createPaymentLink(actor, order.id);
    await cancelOrder(actor, order.id);
    expect((await deliverWebhook(reference)).processed).toBe('needs_review');
    expect((await getOrder(actor, order.id)).order.status).toBe('cancelled');

    const second = await shopWithOrder();
    const link = await createPaymentLink(second.actor, second.order.id);
    await markOrderPaid(second.actor, second.order.id, { method: 'cash' });
    expect((await deliverWebhook(link.reference)).processed).toBe('needs_review');
    expect((await getOrder(second.actor, second.order.id)).order.amountPaid).toBe(1_500_000);
  });
});

describe('manual payments and receipts', () => {
  it('mark as paid records a payment; the receipt appears only once paid and only with the right store', async () => {
    const { actor, order, business } = await shopWithOrder();
    const token = order.receiptToken;
    expect(await getReceipt(business.subdomain, token)).toMatchObject({ isPaid: false, items: [] });

    await markOrderPaid(actor, order.id, { method: 'pos', note: 'Moniepoint' });
    expect(await listOrderPayments(actor, order.id)).toEqual([
      expect.objectContaining({
        provider: 'manual',
        status: 'success',
        method: 'pos',
        amount: 1_500_000,
      }),
    ]);

    const receipt = await getReceipt(business.subdomain, token);
    expect(receipt).toMatchObject({
      isPaid: true,
      customerName: 'Ngozi',
      order: { orderNumber: 1001, total: 1_500_000, amountPaid: 1_500_000 },
      items: [expect.objectContaining({ productName: 'Ankara dress', quantity: 1 })],
    });
    const other = await shopWithStock(1);
    expect(await getReceipt(other.business.subdomain, token)).toBeNull();
    expect(await getReceipt(business.subdomain, 'f'.repeat(32))).toBeNull();
    expect(await getReceipt(business.subdomain, 'not-a-token')).toBeNull();
  });
});

describe('payments isolation', () => {
  it('another business cannot create links for or read payments of my orders', async () => {
    const a = await shopWithOrder();
    const b = await shopWithOrder();
    await expect(createPaymentLink(b.actor, a.order.id)).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(await listOrderPayments(b.actor, a.order.id)).toEqual([]);
  });
});
