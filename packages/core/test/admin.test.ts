import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { schema, withTenant } from '@fulcra/db';
import { eq } from 'drizzle-orm';
import {
  adminActivity,
  adminExtendTrial,
  adminGivePlan,
  adminSetFeature,
  adminSetLimit,
  adminSuspend,
  adminUnsuspend,
} from '../src/admin/actions';
import { getBillingSummary } from '../src/billing/billing';
import { canUse } from '../src/billing/entitlements';
import { getStoreBySubdomain } from '../src/storefront/store';
import { adminFor, requireAdmin } from '../src/admin/access';
import {
  adminGetBusiness,
  adminListBusinesses,
  adminOverview,
  lagosPeriods,
} from '../src/admin/overview';
import { markOrderPaid, createOrder } from '../src/orders/orders';
import { recordAiUsage } from '../src/usage/usage';
import { addMember, shopWithStock } from './helpers';

const original = process.env.ADMIN_EMAILS;
beforeEach(() => {
  process.env.ADMIN_EMAILS = 'Boss@Fulcra.test, second@fulcra.test';
});
afterEach(() => {
  if (original === undefined) delete process.env.ADMIN_EMAILS;
  else process.env.ADMIN_EMAILS = original;
});

const boss = () =>
  adminFor({ id: '00000000-0000-4000-8000-000000000001', email: 'boss@fulcra.test' })!;

describe('admin access', () => {
  it('only listed emails are admins, and removing one takes effect at once', async () => {
    expect(adminFor({ id: 'x', email: 'BOSS@fulcra.test' })).toMatchObject({ admin: true });
    expect(adminFor({ id: 'x', email: 'seller@example.com' })).toBeNull();
    expect(adminFor(null)).toBeNull();
    const admin = boss();
    expect(requireAdmin(admin)).toBe(admin);
    process.env.ADMIN_EMAILS = 'second@fulcra.test';
    expect(() => requireAdmin(admin)).toThrow('Page not found.');
    await expect(adminOverview(admin)).rejects.toThrow('Page not found.');
    delete process.env.ADMIN_EMAILS;
    expect(adminFor({ id: 'x', email: 'second@fulcra.test' })).toBeNull();
    // A forged actor object is not enough either.
    expect(() => requireAdmin({ userId: 'x', email: 'someone@else.test', admin: true })).toThrow();
  });

  it('Lagos periods: today and the month start at midnight Lagos time', () => {
    const p = lagosPeriods(new Date('2026-11-30T23:30:00Z')); // 00:30 on 1 Dec in Lagos
    expect(p.today.toISOString()).toBe('2026-11-30T23:00:00.000Z');
    expect(p.month.toISOString()).toBe('2026-11-30T23:00:00.000Z');
  });
});

describe('admin overview, sellers list and seller page', () => {
  it('counts sign-ups, trials, sales and costs across businesses', async () => {
    const before = await adminOverview(boss());
    const s = await shopWithStock(5);
    const { order } = await createOrder(s.actor, {
      customer: { name: 'Ngozi', phone: '08035550101' },
      items: [{ variantId: s.variant.id, quantity: 2 }],
      fulfilment: 'pickup',
    });
    await markOrderPaid(s.actor, order.id, { method: 'cash' });
    await recordAiUsage(s.business.id, {
      feature: 'agent.reply',
      model: 'claude-haiku-5-5',
      inputTokens: 100_000,
      outputTokens: 10_000,
    });
    const after = await adminOverview(boss());
    expect(after.businesses.total).toBe(before.businesses.total + 1);
    expect(after.businesses.today).toBeGreaterThanOrEqual(1);
    expect(after.plans.trialing).toBe(before.plans.trialing + 1);
    expect(after.thisMonth.sellerOrders).toBe(before.thisMonth.sellerOrders + 1);
    expect(after.thisMonth.sellerSales).toBe(before.thisMonth.sellerSales + 3_000_000);
    expect(after.thisMonth.costUsd.ai).toBeGreaterThan(before.thisMonth.costUsd.ai);
    // Naira (kobo) follows the dollar total at the configured rate (rounding aside).
    expect(
      Math.abs(
        after.thisMonth.costNaira -
          after.thisMonth.costUsd.total * after.thisMonth.usdToNaira * 100,
      ),
    ).toBeLessThan(after.thisMonth.usdToNaira);
    expect(after.health.checks.database.ok).toBe(true);
  });

  it('lists sellers with search by name, store address or owner email, and status filter', async () => {
    const s = await shopWithStock(5);
    await recordAiUsage(s.business.id, {
      feature: 'agent.reply',
      model: 'claude-haiku-5-5',
      inputTokens: 1000,
      outputTokens: 100,
    });
    const byAddress = await adminListBusinesses(boss(), { q: s.business.subdomain });
    expect(byAddress.rows).toHaveLength(1);
    expect(byAddress.rows[0]).toMatchObject({
      id: s.business.id,
      ownerEmail: s.owner.email,
      plan: 'growth',
      status: 'trialing',
      ordersThisMonth: 0,
    });
    expect(byAddress.rows[0]!.costUsdThisMonth).toBeGreaterThan(0);
    const byEmail = await adminListBusinesses(boss(), { q: s.owner.email.toUpperCase() });
    expect(byEmail.rows.map((r) => r.id)).toEqual([s.business.id]);
    const paying = await adminListBusinesses(boss(), { q: s.business.subdomain, status: 'paying' });
    expect(paying.rows).toEqual([]);
    // "%" in a search is a character, not a wildcard.
    expect(
      (await adminListBusinesses(boss(), { q: '%' })).rows.every((r) => r.name.includes('%')),
    ).toBe(true);
  });

  it('shows one seller in full, and refuses non-admins and unknown ids', async () => {
    const s = await shopWithStock(5);
    await addMember(s.actor, 'staff');
    const detail = await adminGetBusiness(boss(), s.business.id);
    expect(detail).toMatchObject({
      id: s.business.id,
      subdomain: s.business.subdomain,
      payoutConfigured: false,
      plan: { code: 'growth', status: 'trialing', conversationLimit: 100 },
      counts: { products: 1, customers: 0, orders: 0, paidOrders: 0 },
      overrides: expect.any(Array),
    });
    expect(detail.team.map((m) => m.role)).toEqual(['owner', 'staff']);
    await expect(adminGetBusiness(boss(), '00000000-0000-4000-8000-000000000999')).rejects.toThrow(
      'does not exist',
    );
    await expect(adminGetBusiness(boss(), 'nonsense')).rejects.toThrow('does not exist');
    await expect(
      adminGetBusiness({ userId: 'x', email: 'seller@example.com', admin: true }, s.business.id),
    ).rejects.toThrow('Page not found.');
  });
});

describe('admin actions (AD2)', () => {
  it('extends a trial from its end (or from today once ended), and refuses paying sellers', async () => {
    const s = await shopWithStock(1);
    const before = (await getBillingSummary(s.actor)).trialEndsAt!;
    const { trialEndsAt } = await adminExtendTrial(boss(), s.business.id, {
      days: 7,
      reason: 'Design partner',
    });
    expect(trialEndsAt.getTime() - before.getTime()).toBe(7 * 86_400_000);
    // An ended trial restarts from today.
    const later = new Date(trialEndsAt.getTime() + 30 * 86_400_000);
    const again = await adminExtendTrial(
      boss(),
      s.business.id,
      { days: 3, reason: 'Second chance' },
      later,
    );
    expect(again.trialEndsAt.getTime()).toBe(later.getTime() + 3 * 86_400_000);
    await expect(
      adminExtendTrial(boss(), s.business.id, { days: 0, reason: 'x y z' }),
    ).rejects.toThrow('At least 1 day');
    await expect(adminExtendTrial(boss(), s.business.id, { days: 5, reason: '' })).rejects.toThrow(
      'short reason',
    );

    await adminGivePlan(boss(), s.business.id, { planCode: 'pro', months: 2, reason: 'Friend' });
    await expect(
      adminExtendTrial(boss(), s.business.id, { days: 5, reason: 'Oops now' }),
    ).rejects.toThrow('on a plan');
  });

  it('gives a plan for free until a date, counted as given free and not as recurring income', async () => {
    const s = await shopWithStock(1);
    const before = await adminOverview(boss());
    const { until } = await adminGivePlan(boss(), s.business.id, {
      planCode: 'pro',
      months: 3,
      reason: 'Design partner',
    });
    const summary = await getBillingSummary(s.actor);
    expect(summary).toMatchObject({ planCode: 'pro', status: 'active', active: true });
    expect(summary.currentPeriodEnd?.getTime()).toBe(until.getTime());
    const after = await adminOverview(boss());
    expect(after.plans.givenFree).toBe(before.plans.givenFree + 1);
    expect(after.plans.monthlyRecurring).toBe(before.plans.monthlyRecurring);
    expect((await adminGetBusiness(boss(), s.business.id)).plan).toMatchObject({
      code: 'pro',
      givenFree: true,
    });
    // A seller paying by card is changed at Paystack, not here.
    await withTenant(s.business.id, (tx) =>
      tx
        .update(schema.subscriptions)
        .set({ paystackSubscriptionCode: 'SUB_card' })
        .where(eq(schema.subscriptions.businessId, s.business.id)),
    );
    await expect(
      adminGivePlan(boss(), s.business.id, { planCode: 'starter', months: 1, reason: 'Downgrade' }),
    ).rejects.toThrow('pays by card');
  });

  it('changes limits and switches features, and back to the plan', async () => {
    const s = await shopWithStock(1);
    await adminSetLimit(boss(), s.business.id, {
      key: 'agent.conversations',
      limit: 500,
      reason: 'Busy week',
    });
    await adminSetLimit(boss(), s.business.id, {
      key: 'owner.messages',
      limit: 120,
      reason: 'Busy week',
    });
    let detail = await adminGetBusiness(boss(), s.business.id);
    expect(detail.plan).toMatchObject({ conversationLimit: 500, ownerMessageLimit: 120 });
    await adminSetLimit(boss(), s.business.id, {
      key: 'agent.conversations',
      limit: null,
      reason: 'Back to normal',
    });
    detail = await adminGetBusiness(boss(), s.business.id);
    expect(detail.plan.conversationLimit).toBe(100);

    expect(await canUse(s.business.id, 'agent')).toBe(true);
    await adminSetFeature(boss(), s.business.id, {
      feature: 'agent',
      enabled: false,
      reason: 'Abuse report',
    });
    expect(await canUse(s.business.id, 'agent')).toBe(false);
    await adminSetFeature(boss(), s.business.id, {
      feature: 'owner_alerts',
      enabled: true,
      reason: 'Testing alerts',
    });
    expect(await canUse(s.business.id, 'owner_alerts')).toBe(true);
    await adminSetFeature(boss(), s.business.id, {
      feature: 'agent',
      enabled: null,
      reason: 'Resolved',
    });
    expect(await canUse(s.business.id, 'agent')).toBe(true);
  });

  it('suspends: store offline, assistant and alerts off, dashboard notice; lifting restores it', async () => {
    const s = await shopWithStock(1);
    await adminSetFeature(boss(), s.business.id, {
      feature: 'owner_alerts',
      enabled: true,
      reason: 'Was on',
    });
    const { subdomain } = await adminSuspend(boss(), s.business.id, {
      reason: 'Fraud reports from customers',
    });
    expect(subdomain).toBe(s.business.subdomain);
    expect(await getStoreBySubdomain(subdomain)).toMatchObject({
      suspended: true,
      checkout: false,
    });
    expect(await canUse(s.business.id, 'agent')).toBe(false);
    expect(await canUse(s.business.id, 'storefront')).toBe(false);
    // Suspension wins over Fulcra's own switches.
    expect(await canUse(s.business.id, 'owner_alerts')).toBe(false);
    expect(await canUse(s.business.id, 'payments')).toBe(true);
    expect((await getBillingSummary(s.actor)).suspended).toBe(true);
    expect((await adminGetBusiness(boss(), s.business.id)).suspended?.reason).toBe(
      'Fraud reports from customers',
    );
    expect((await adminListBusinesses(boss(), { q: subdomain })).rows[0]!.suspended).toBe(true);
    await expect(adminSuspend(boss(), s.business.id, { reason: 'Again' })).rejects.toThrow(
      'already suspended',
    );

    await adminUnsuspend(boss(), s.business.id, { reason: 'Seller explained, refunds done' });
    expect(await getStoreBySubdomain(subdomain)).toMatchObject({ suspended: false });
    expect(await canUse(s.business.id, 'agent')).toBe(true);
    await expect(adminUnsuspend(boss(), s.business.id, { reason: 'Again' })).rejects.toThrow(
      'not suspended',
    );
  });

  it('logs every change with who, what and why; only admins can act or read it', async () => {
    const s = await shopWithStock(1);
    await adminExtendTrial(boss(), s.business.id, { days: 2, reason: 'Asked nicely' });
    await adminSuspend(boss(), s.business.id, { reason: 'Chargebacks' });
    const log = await adminActivity(boss(), { businessId: s.business.id });
    expect(log.map((l) => [l.action, l.reason, l.adminEmail])).toEqual([
      ['suspend', 'Chargebacks', 'boss@fulcra.test'],
      ['extend_trial', 'Asked nicely', 'boss@fulcra.test'],
    ]);
    expect(log[1]!.details).toMatchObject({ days: 2 });
    expect((await adminActivity(boss(), { limit: 5 })).length).toBeGreaterThan(0);
    const stranger = { userId: 'x', email: 'seller@example.com', admin: true as const };
    await expect(adminSuspend(stranger, s.business.id, { reason: 'Not allowed' })).rejects.toThrow(
      'Page not found.',
    );
    await expect(adminActivity(stranger)).rejects.toThrow('Page not found.');
    await expect(
      adminExtendTrial(boss(), '00000000-0000-4000-8000-000000000999', {
        days: 1,
        reason: 'Nobody',
      }),
    ).rejects.toThrow('does not exist');
    // A failed action leaves no log row.
    expect((await adminActivity(boss(), { businessId: s.business.id })).length).toBe(2);
  });
});
