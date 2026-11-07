import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createOrder, getOrder, cancelOrder } from '../src/orders/orders';
import { listEvents } from '../src/events/events';
import { findOrCreateCustomer } from '../src/customers/customers';
import { setPaystackClient } from '../src/payments/paystack';
import { clearBankCache, savePayoutAccount } from '../src/payments/payout';
import { processPaystackWebhook, recordPaystackWebhook } from '../src/payments/payments';
import {
  getCustomerDedicatedAccount,
  getOrCreateDedicatedAccount,
  prepareAccountDetails,
} from '../src/payments/dedicated-accounts';
import { assignPayment, dismissPayment, listPayments } from '../src/payments/transfers';
import { getReceipt } from '../src/payments/receipts';
import { FakePaystack, TEST_SECRET } from './fake-paystack';
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

async function shop() {
  const s = await shopWithStock(20);
  await savePayoutAccount(s.actor, { bankCode: '058', accountNumber: '0123456789' });
  const order = async (phone = '08035550101', quantity = 1) =>
    await createOrder(s.actor, {
      customer: { name: 'Ngozi Okafor', phone },
      items: [{ variantId: s.variant.id, quantity }],
      fulfilment: 'pickup',
    });
  return { ...s, order };
}

/** Customer transfers into their account; Paystack calls the webhook; the worker processes it. */
async function transfer(customerCode: string, amount: number) {
  const { body, signature } = paystack.transfer(customerCode, amount);
  const saved = await recordPaystackWebhook(body, signature);
  if (saved.status !== 'saved') throw new Error('expected saved: ' + saved.status);
  return { result: await processPaystackWebhook(saved.webhookEventId), body, signature, saved };
}

const codeOf = (fake: FakePaystack) => [...fake.dedicated.keys()].at(-1)!;

describe('dedicated accounts', () => {
  it('creates one account per customer, linked to the seller, and reuses it', async () => {
    const s = await shop();
    const { order, customer } = await s.order();
    const { account, message } = await prepareAccountDetails(s.actor, order.id);
    expect(account).toMatchObject({ bankName: 'Test Bank', accountName: 'FULCRA/NGOZI OKAFOR' });
    expect(message).toContain(account.accountNumber);
    expect(message).toContain('₦15,000.00');
    expect(message).toContain(`order #${order.orderNumber}`);
    expect((await getOrder(s.actor, order.id)).order.status).toBe('awaiting_payment');

    const [code, dva] = [...paystack.dedicated.entries()][0]!;
    expect(dva).toMatchObject({ subaccount: 'ACCT_1', preferredBank: 'test-bank' });
    expect(paystack.customers.get(code)!.email).toBe(`dva-${customer.id}@customers.yourdomain.com`);

    const again = await getOrCreateDedicatedAccount(s.actor, customer.id);
    expect(again.accountNumber).toBe(account.accountNumber);
    expect(paystack.dedicated.size).toBe(1);
    expect(await getCustomerDedicatedAccount(s.actor, customer.id)).toEqual(account);
  });

  it('the same person at two businesses gets two separate accounts', async () => {
    const a = await shop();
    const b = await shop();
    const oa = await a.order();
    const ob = await b.order();
    const accA = await getOrCreateDedicatedAccount(a.actor, oa.customer.id);
    const accB = await getOrCreateDedicatedAccount(b.actor, ob.customer.id);
    expect(accA.accountNumber).not.toBe(accB.accountNumber);
    expect(paystack.customers.size).toBe(2);
  });

  it('needs payout setup, a name and a phone; a Paystack refusal suggests the payment link', async () => {
    const plain = await shopWithStock(5);
    const { customer } = await findOrCreateCustomer(plain.actor, {
      name: 'X',
      phone: '08011111111',
    });
    await expect(getOrCreateDedicatedAccount(plain.actor, customer.id)).rejects.toMatchObject({
      field: 'payout',
    });

    const s = await shop();
    const { customer: noPhone } = await findOrCreateCustomer(s.actor, { name: 'No Phone' });
    await expect(getOrCreateDedicatedAccount(s.actor, noPhone.id)).rejects.toMatchObject({
      field: 'customer',
    });

    const { customer: c } = await findOrCreateCustomer(s.actor, {
      name: 'Has Phone',
      phone: '08022222222',
    });
    paystack.failDedicated = 'Dedicated NUBAN not available for this business';
    await expect(getOrCreateDedicatedAccount(s.actor, c.id)).rejects.toMatchObject({
      code: 'conflict',
      message: expect.stringContaining('Send a payment link instead'),
    });
    paystack.failDedicated = null;
    await expect(getOrCreateDedicatedAccount(s.actor, c.id)).resolves.toBeTruthy();
  });

  it('riders cannot create accounts', async () => {
    const s = await shop();
    const { customer } = await s.order();
    const rider = await addMember(s.actor, 'rider');
    await expect(getOrCreateDedicatedAccount(rider, customer.id)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});

describe('matching transfers to orders', () => {
  it('a transfer of exactly the total pays that customer’s order, once, with a receipt', async () => {
    const s = await shop();
    const { order, customer } = await s.order();
    await prepareAccountDetails(s.actor, order.id);
    const { result, body, signature } = await transfer(codeOf(paystack), 1_500_000);
    expect(result).toBe('matched');

    const paid = (await getOrder(s.actor, order.id)).order;
    expect(paid).toMatchObject({
      status: 'paid',
      amountPaid: 1_500_000,
      paymentMethod: 'bank_transfer',
    });
    expect((await getReceipt(s.business.subdomain, order.receiptToken))?.isPaid).toBe(true);

    // Paystack resends: saved once, counted once.
    expect(await recordPaystackWebhook(body, signature)).toMatchObject({
      status: 'duplicate',
      processed: true,
    });
    const payments = await listPayments(s.actor);
    expect(payments).toEqual([
      expect.objectContaining({
        status: 'success',
        orderNumber: order.orderNumber,
        customerName: 'Ngozi Okafor',
      }),
    ]);
    expect(
      (await listEvents(s.actor, { customerId: customer.id })).filter(
        (e) => e.type === 'payment.confirmed',
      ),
    ).toHaveLength(1);
  });

  it('with several unpaid orders, the oldest one with exactly that amount is paid', async () => {
    const s = await shop();
    const first = await s.order('08035550101', 2); // ₦30,000
    const second = await s.order('08035550101', 1); // ₦15,000
    const third = await s.order('08035550101', 1); // ₦15,000
    await prepareAccountDetails(s.actor, first.order.id);
    expect((await transfer(codeOf(paystack), 1_500_000)).result).toBe('matched');
    expect((await getOrder(s.actor, second.order.id)).order.status).toBe('paid');
    expect((await getOrder(s.actor, third.order.id)).order.status).toBe('new');
    expect((await getOrder(s.actor, first.order.id)).order.status).toBe('awaiting_payment');
  });

  it('a different amount or no open order is unmatched; the owner assigns or dismisses it', async () => {
    const s = await shop();
    const { order } = await s.order();
    await prepareAccountDetails(s.actor, order.id);
    const code = codeOf(paystack);

    expect((await transfer(code, 1_000_000)).result).toBe('unmatched');
    expect((await getOrder(s.actor, order.id)).order.status).toBe('awaiting_payment');
    const [unmatched] = await listPayments(s.actor, { show: 'unmatched' });
    expect(unmatched).toMatchObject({
      amount: 1_000_000,
      orderId: null,
      customerName: 'Ngozi Okafor',
      reviewReason: expect.stringContaining('exactly this amount'),
    });
    expect((await listEvents(s.actor)).some((e) => e.type === 'payment.unmatched')).toBe(true);

    // Wrong amount cannot be assigned (part payments come later).
    await expect(assignPayment(s.actor, unmatched!.id, order.id)).rejects.toMatchObject({
      field: 'orderId',
    });
    await dismissPayment(s.actor, unmatched!.id, 'Refunded the customer');
    expect(await listPayments(s.actor, { show: 'unmatched' })).toEqual([]);
    await expect(dismissPayment(s.actor, unmatched!.id, '')).rejects.toMatchObject({
      code: 'conflict',
    });

    // A right-amount transfer after the order was cancelled → unmatched, then assigned to a new order.
    await cancelOrder(s.actor, order.id);
    expect((await transfer(code, 1_500_000)).result).toBe('unmatched');
    const [late] = await listPayments(s.actor, { show: 'unmatched' });
    const fresh = await s.order();
    await assignPayment(s.actor, late!.id, fresh.order.id);
    expect((await getOrder(s.actor, fresh.order.id)).order).toMatchObject({
      status: 'paid',
      amountPaid: 1_500_000,
    });
    await expect(assignPayment(s.actor, late!.id, fresh.order.id)).rejects.toMatchObject({
      code: 'conflict',
    });
  });

  it('a transfer Paystack attributes to a different customer is not accepted', async () => {
    const s = await shop();
    const { order } = await s.order();
    await prepareAccountDetails(s.actor, order.id);
    const { body, signature } = paystack.transfer(codeOf(paystack), 1_500_000);
    const reference = JSON.parse(body).data.reference as string;
    paystack.verifyResult.set(reference, { customerCode: 'CUS_someone_else' });
    const saved = await recordPaystackWebhook(body, signature);
    if (saved.status !== 'saved') throw new Error('expected saved');
    expect(await processPaystackWebhook(saved.webhookEventId)).toBe('unknown_reference');
    expect((await getOrder(s.actor, order.id)).order.status).toBe('awaiting_payment');
  });

  it('two different transfers processed at once pay two orders, never one twice', async () => {
    const s = await shop();
    const a = await s.order();
    const b = await s.order();
    await prepareAccountDetails(s.actor, a.order.id);
    const code = codeOf(paystack);
    const results = await Promise.all([transfer(code, 1_500_000), transfer(code, 1_500_000)]);
    const outcomes = results.map((r) => r.result).sort();
    // Usually both match; under a tight race one may go to Unmatched for the owner. Never a double payment.
    expect(outcomes.every((o) => o === 'matched' || o === 'unmatched')).toBe(true);
    const orders = [
      (await getOrder(s.actor, a.order.id)).order,
      (await getOrder(s.actor, b.order.id)).order,
    ];
    for (const o of orders) expect([0, 1_500_000]).toContain(o.amountPaid);
    expect(orders.filter((o) => o.status === 'paid')).toHaveLength(
      outcomes.filter((o) => o === 'matched').length,
    );
  });
});

describe('transfers isolation', () => {
  it('another business cannot see, assign or dismiss my transfers, or create accounts for my customers', async () => {
    const a = await shop();
    const b = await shop();
    const { order, customer } = await a.order();
    await prepareAccountDetails(a.actor, order.id);
    await transfer(codeOf(paystack), 999_00);
    const [mine] = await listPayments(a.actor, { show: 'unmatched' });

    expect(await listPayments(b.actor)).toEqual([]);
    const bOrder = await b.order();
    await expect(assignPayment(b.actor, mine!.id, bOrder.order.id)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(dismissPayment(b.actor, mine!.id, 'x')).rejects.toMatchObject({
      code: 'conflict',
    });
    await expect(getOrCreateDedicatedAccount(b.actor, customer.id)).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(await getCustomerDedicatedAccount(b.actor, customer.id)).toBeNull();
    await expect(prepareAccountDetails(b.actor, order.id)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
