import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as QueueModule from '../src/jobs/queue';

vi.mock('../src/jobs/queue', async (original) => ({
  ...(await original<typeof QueueModule>()),
  enqueuePaystackWebhook: async () => {},
}));

const { schema, withSystem, withTenant } = await import('@fulcra/db');
const { eq } = await import('drizzle-orm');
const s = await import('../src/billing/subscriptions');
const { getBillingSummary } = await import('../src/billing/billing');
const { canUse } = await import('../src/billing/entitlements');
const { recordPaystackWebhook, processPaystackWebhook } = await import('../src/payments/payments');
const { setPaystackClient } = await import('../src/payments/paystack');
const { FakePaystack, TEST_SECRET, signedWebhook } = await import('../src/testing/fake-paystack');
const { addMember, newBusiness } = await import('./helpers');

let fake: InstanceType<typeof FakePaystack>;
const originalKey = process.env.PAYSTACK_SECRET_KEY;
beforeEach(() => {
  fake = new FakePaystack();
  setPaystackClient(fake);
  process.env.PAYSTACK_SECRET_KEY = TEST_SECRET;
});
afterEach(() => {
  setPaystackClient(null);
  if (originalKey === undefined) delete process.env.PAYSTACK_SECRET_KEY;
  else process.env.PAYSTACK_SECRET_KEY = originalKey;
});

async function deliver(hook: { body: string; signature: string }) {
  const saved = await recordPaystackWebhook(hook.body, hook.signature);
  if (saved.status !== 'saved' && saved.status !== 'duplicate') throw new Error(saved.status);
  return processPaystackWebhook(saved.webhookEventId);
}
const planCode = async (code: string, interval: 'monthly' | 'annual' = 'monthly') => {
  const [row] = await withSystem((tx) =>
    tx.select().from(schema.plans).where(eq(schema.plans.code, code)),
  );
  return (interval === 'monthly' ? row!.paystackMonthlyPlanCode : row!.paystackAnnualPlanCode)!;
};
const subRow = async (businessId: string) =>
  (await withTenant(businessId, (tx) => tx.select().from(schema.subscriptions)))[0]!;

/** A business that paid for a plan through checkout (and got its subscription code). */
async function payingShop(plan: 'starter' | 'growth' | 'pro' = 'growth') {
  await s.syncBillingPlans();
  const shop = await newBusiness('subs');
  const result = await s.choosePlan(shop.actor, { plan, interval: 'monthly' });
  expect(result.kind).toBe('checkout');
  const checkout = fake.planCheckouts.at(-1)!;
  const customerCode = `CUS_${randomUUID().slice(0, 8)}`;
  expect(
    await deliver(
      fake.subscriptionCharge({
        reference: checkout.reference,
        planCode: checkout.planCode,
        amount: checkout.amount,
        customerCode,
        email: checkout.email,
        metadata: checkout.metadata,
      }),
    ),
  ).toBe('confirmed');
  const subscriptionCode = `SUB_${randomUUID().slice(0, 8)}`;
  await deliver(
    signedWebhook('subscription.create', {
      subscription_code: subscriptionCode,
      email_token: `tok_${subscriptionCode}`,
      customer: { customer_code: customerCode },
      next_payment_date: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    }),
  );
  return { ...shop, customerCode, subscriptionCode, checkout };
}

describe('plans at Paystack', () => {
  it('each plan and interval is created once at Paystack', async () => {
    await s.syncBillingPlans();
    const rows = await withSystem((tx) => tx.select().from(schema.plans));
    expect(rows.map((r) => r.code).sort()).toEqual(['growth', 'pro', 'starter']);
    expect(rows.every((r) => r.paystackMonthlyPlanCode && r.paystackAnnualPlanCode)).toBe(true);
    expect(await s.syncBillingPlans()).toBe(0);
  });
});

describe('paying for a plan', () => {
  it('owner checkout with the plan price; the verified payment turns the plan on, once', async () => {
    await s.syncBillingPlans();
    const shop = await newBusiness('subs-pay');
    const staff = await addMember(shop.actor, 'staff');
    await expect(s.choosePlan(staff, { plan: 'growth', interval: 'monthly' })).rejects.toThrow();
    const result = await s.choosePlan(shop.actor, { plan: 'growth', interval: 'annual' });
    expect(result).toMatchObject({
      kind: 'checkout',
      url: expect.stringContaining('checkout.paystack.com'),
    });
    const checkout = fake.planCheckouts.at(-1)!;
    expect(checkout).toMatchObject({
      amount: 25_000_000,
      planCode: await planCode('growth', 'annual'),
      email: shop.owner.email.toLowerCase(),
      metadata: {
        kind: 'fulcra_subscription',
        businessId: shop.business.id,
        plan: 'growth',
        interval: 'annual',
      },
    });

    const hook = fake.subscriptionCharge({
      reference: checkout.reference,
      planCode: checkout.planCode,
      amount: checkout.amount,
      customerCode: 'CUS_paid',
      email: checkout.email,
      metadata: checkout.metadata,
    });
    expect(await deliver(hook)).toBe('confirmed');
    expect(await deliver(hook)).toBe('already_processed');
    const summary = await getBillingSummary(shop.actor);
    expect(summary).toMatchObject({ planCode: 'growth', status: 'active', active: true });
    expect(summary.currentPeriodEnd!.getTime()).toBeGreaterThan(Date.now() + 360 * 86_400_000);
    expect(summary.invoices.map((i) => [i.amount, i.interval])).toEqual([[25_000_000, 'annual']]);
    expect(fake.verifyCalls).toContain(checkout.reference);
  });

  it('a payment below the plan price does not turn a plan on', async () => {
    await s.syncBillingPlans();
    const shop = await newBusiness('subs-low');
    await s.choosePlan(shop.actor, { plan: 'pro', interval: 'monthly' });
    const checkout = fake.planCheckouts.at(-1)!;
    const result = await deliver(
      fake.subscriptionCharge({
        reference: checkout.reference,
        planCode: checkout.planCode,
        amount: 100,
        customerCode: 'CUS_low',
        email: checkout.email,
        metadata: checkout.metadata,
      }),
    );
    expect(result).toBe('needs_review');
    expect((await getBillingSummary(shop.actor)).status).toBe('trialing');
  });

  it('renewals extend the plan; a failed renewal gives a grace period', async () => {
    const shop = await payingShop('growth');
    const before = (await subRow(shop.business.id)).currentPeriodEnd!;
    // Paystack charges the card next month (no metadata: found by the customer).
    await deliver(
      fake.subscriptionCharge({
        reference: `renew_${randomUUID()}`,
        planCode: await planCode('growth'),
        amount: 2_500_000,
        customerCode: shop.customerCode,
        email: shop.checkout.email,
      }),
    );
    expect((await getBillingSummary(shop.actor)).invoices).toHaveLength(2);
    expect((await subRow(shop.business.id)).currentPeriodEnd!.getTime()).toBeGreaterThanOrEqual(
      before.getTime(),
    );

    await deliver(
      signedWebhook('invoice.payment_failed', {
        invoice_code: `INV_${randomUUID().slice(0, 8)}`,
        subscription: { subscription_code: shop.subscriptionCode },
        customer: { customer_code: shop.customerCode },
      }),
    );
    expect((await getBillingSummary(shop.actor)).status).toBe('past_due');
    expect(await canUse(shop.business.id, 'agent')).toBe(true); // grace
  });
});

describe('changing plan', () => {
  it('upgrade: checkout now; once paid the bigger plan starts and the old one stops renewing', async () => {
    const shop = await payingShop('growth');
    await expect(s.choosePlan(shop.actor, { plan: 'growth', interval: 'monthly' })).rejects.toThrow(
      'already on this plan',
    );
    const result = await s.choosePlan(shop.actor, { plan: 'pro', interval: 'monthly' });
    expect(result.kind).toBe('checkout');
    const checkout = fake.planCheckouts.at(-1)!;
    await deliver(
      fake.subscriptionCharge({
        reference: checkout.reference,
        planCode: checkout.planCode,
        amount: checkout.amount,
        customerCode: shop.customerCode,
        email: checkout.email,
        metadata: checkout.metadata,
      }),
    );
    expect((await getBillingSummary(shop.actor)).planCode).toBe('pro');
    expect(fake.disabled).toContain(shop.subscriptionCode);
    // Paystack later reports the old one disabled: nothing changes.
    await deliver(
      signedWebhook('subscription.disable', { subscription_code: shop.subscriptionCode }),
    );
    expect((await getBillingSummary(shop.actor)).status).toBe('active');
  });

  it('downgrade: the smaller plan starts on the saved card when the paid period ends', async () => {
    const shop = await payingShop('pro');
    const periodEnd = (await subRow(shop.business.id)).currentPeriodEnd!;
    const result = await s.choosePlan(shop.actor, { plan: 'starter', interval: 'monthly' });
    expect(result).toEqual({ kind: 'scheduled', startsAt: periodEnd });
    expect(fake.disabled).toContain(shop.subscriptionCode);
    const [next] = [...fake.subscriptions.values()].slice(-1);
    expect(next).toMatchObject({
      customerCode: shop.customerCode,
      planCode: await planCode('starter'),
      authorizationCode: `AUTH_${shop.customerCode}`,
      startDate: periodEnd,
    });
    let summary = await getBillingSummary(shop.actor);
    expect(summary).toMatchObject({
      planCode: 'pro',
      pendingPlanCode: 'starter',
      status: 'active',
    });

    // At the end of the period Paystack charges the starter plan.
    await deliver(
      fake.subscriptionCharge({
        reference: `down_${randomUUID()}`,
        planCode: await planCode('starter'),
        amount: 1_250_000,
        customerCode: shop.customerCode,
        email: shop.checkout.email,
      }),
    );
    summary = await getBillingSummary(shop.actor);
    expect(summary).toMatchObject({ planCode: 'starter', pendingPlanCode: null, status: 'active' });
  });

  it('cancel: stops renewing; features work until the end of the paid period', async () => {
    const shop = await payingShop('growth');
    await expect(s.cancelPlan(await addMember(shop.actor, 'staff'))).rejects.toThrow();
    await s.cancelPlan(shop.actor);
    expect(fake.disabled).toContain(shop.subscriptionCode);
    const summary = await getBillingSummary(shop.actor);
    expect(summary).toMatchObject({ status: 'cancelled', active: true });
    expect(await canUse(shop.business.id, 'owner_alerts')).toBe(true);
    await expect(s.cancelPlan(shop.actor)).rejects.toThrow('no paid plan');
    const trial = await newBusiness('subs-trial');
    await expect(s.cancelPlan(trial.actor)).rejects.toThrow('no paid plan');
  });
});

describe('webhook order', () => {
  it('"subscription created" before its payment is retried, then linked', async () => {
    await s.syncBillingPlans();
    const shop = await newBusiness('subs-order');
    await s.choosePlan(shop.actor, { plan: 'growth', interval: 'monthly' });
    const checkout = fake.planCheckouts.at(-1)!;
    const early = `SUB_early_${randomUUID().slice(0, 8)}`;
    const customer = `CUS_early_${randomUUID().slice(0, 8)}`;
    const created = signedWebhook('subscription.create', {
      subscription_code: early,
      email_token: 'tok_early',
      customer: { customer_code: customer },
    });
    await expect(deliver(created)).rejects.toThrow('not linked to a business yet');
    await deliver(
      fake.subscriptionCharge({
        reference: checkout.reference,
        planCode: checkout.planCode,
        amount: checkout.amount,
        customerCode: customer,
        email: checkout.email,
        metadata: checkout.metadata,
      }),
    );
    expect(await deliver(created)).toBe('confirmed'); // the retry
    expect((await subRow(shop.business.id)).paystackSubscriptionCode).toBe(early);
  });
});
