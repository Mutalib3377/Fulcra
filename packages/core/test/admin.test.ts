import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
