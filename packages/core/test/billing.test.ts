import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type * as QueueModule from '../src/jobs/queue';

vi.mock('../src/jobs/queue', async (original) => ({
  ...(await original<typeof QueueModule>()),
  enqueueSubmitTemplates: async () => {},
  enqueueSendMessage: async () => {},
}));

const { schema, withTenant } = await import('@fulcra/db');
const { eq } = await import('drizzle-orm');
const rules = await import('../src/billing/rules');
const ent = await import('../src/billing/entitlements');
const { claimAgentConversation, conversationUsage } = await import('../src/billing/usage');
const { getBillingSummary } = await import('../src/billing/billing');
const ch = await import('../src/conversations/channels');
const { setWebChatEnabled } = await import('../src/conversations/web-chat');
const { listEvents } = await import('../src/events/events');
const { addMember, newBusiness } = await import('./helpers');

const day = 86_400_000;
const setSub = (businessId: string, values: Partial<typeof schema.subscriptions.$inferInsert>) =>
  withTenant(businessId, (tx) =>
    tx
      .update(schema.subscriptions)
      .set(values)
      .where(eq(schema.subscriptions.businessId, businessId)),
  );
const phoneId = () => String(100_000_000_000 + Math.floor(Math.random() * 1e11));
const token = 'EAAG' + 'x'.repeat(40);

describe('plan status from dates', () => {
  const now = new Date('2026-11-16T12:00:00Z');
  const at = (days: number) => new Date(now.getTime() + days * day);
  const base = { trialEndsAt: null, currentPeriodEnd: null, graceEndsAt: null };
  it('trial, paid period, grace after a missed renewal, cancelled, ended', () => {
    expect(rules.effectiveStatus({ ...base, status: 'trialing', trialEndsAt: at(3) }, now)).toBe(
      'trialing',
    );
    expect(rules.effectiveStatus({ ...base, status: 'trialing', trialEndsAt: at(-1) }, now)).toBe(
      'expired',
    );
    expect(
      rules.effectiveStatus({ ...base, status: 'active', currentPeriodEnd: at(10) }, now),
    ).toBe('active');
    expect(
      rules.effectiveStatus({ ...base, status: 'active', currentPeriodEnd: at(-2) }, now),
    ).toBe('past_due');
    expect(
      rules.effectiveStatus({ ...base, status: 'active', currentPeriodEnd: at(-8) }, now),
    ).toBe('expired');
    expect(rules.effectiveStatus({ ...base, status: 'past_due', graceEndsAt: at(1) }, now)).toBe(
      'past_due',
    );
    expect(
      rules.effectiveStatus({ ...base, status: 'cancelled', currentPeriodEnd: at(5) }, now),
    ).toBe('cancelled');
    expect(
      rules.effectiveStatus({ ...base, status: 'cancelled', currentPeriodEnd: at(-1) }, now),
    ).toBe('expired');
    expect(rules.isActiveStatus('expired')).toBe(false);
    expect(rules.planFor('owner_alerts').code).toBe('growth');
    expect(rules.PLANS.growth.annualPrice).toBe(rules.PLANS.growth.monthlyPrice * 10);
  });
});

describe('what a business can use', () => {
  it('a new business is on a 14-day trial of Growth with 100 chats and no WhatsApp alerts', async () => {
    const shop = await newBusiness('bill');
    const summary = await getBillingSummary(shop.actor);
    expect(summary).toMatchObject({ planCode: 'growth', status: 'trialing', active: true });
    expect(summary.trialEndsAt!.getTime()).toBeGreaterThan(Date.now() + 13 * day);
    expect(summary.usage).toMatchObject({ used: 0, limit: 100 });
    for (const f of ['agent', 'catalog_import.shops', 'channel.instagram'] as const)
      expect(await ent.canUse(shop.business.id, f)).toBe(true);
    // Alerts are sent from Fulcra's number (a cost to Fulcra): paid plans only.
    expect(await ent.featureAccess(shop.business.id, 'owner_alerts')).toEqual({
      allowed: false,
      message: expect.stringContaining('WhatsApp alerts start when you choose a plan'),
    });
    // Fulcra can switch them on for one business (e.g. a design partner).
    await ent.setBusinessEntitlement(shop.business.id, 'owner_alerts', { enabled: true });
    expect(await ent.canUse(shop.business.id, 'owner_alerts')).toBe(true);
    const rider = await addMember(shop.actor, 'rider');
    await expect(getBillingSummary(rider)).rejects.toThrow();
  });

  it('when the trial ends: sales and data keep working, the assistant and alerts pause', async () => {
    const shop = await newBusiness('bill-end');
    await setSub(shop.business.id, { trialEndsAt: new Date(Date.now() - day) });
    expect((await getBillingSummary(shop.actor)).status).toBe('expired');
    expect(await ent.canUse(shop.business.id, 'storefront')).toBe(true);
    expect(await ent.canUse(shop.business.id, 'payments')).toBe(true);
    expect(await ent.canUse(shop.business.id, 'agent')).toBe(false);
    expect(await ent.featureAccess(shop.business.id, 'owner_alerts')).toEqual({
      allowed: false,
      message: expect.stringContaining('Your Fulcra plan has ended'),
    });
    expect(await claimAgentConversation(shop.business.id, randomUUID())).toMatchObject({
      allowed: false,
      reason: 'Your Fulcra plan has ended, so the assistant is paused',
    });
    await expect(setWebChatEnabled(shop.actor, true)).rejects.toThrow('plan has ended');
  });

  it('Starter: one channel at a time, no alerts or shop imports; Fulcra can switch a feature on', async () => {
    const shop = await newBusiness('bill-starter');
    await setSub(shop.business.id, {
      planCode: 'starter',
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 20 * day),
    });
    expect((await ent.featureAccess(shop.business.id, 'owner_alerts')).message).toContain(
      'part of the Growth plan',
    );
    expect(await ent.canUse(shop.business.id, 'catalog_import.shops')).toBe(false);
    expect(await ent.canUse(shop.business.id, 'catalog_import')).toBe(true);

    await ch.saveWhatsAppConnection(shop.actor, {
      phoneNumberId: phoneId(),
      businessAccountId: '987654321012345',
      accessToken: token,
    });
    await expect(
      ch.saveInstagramConnection(shop.actor, {
        accountId: '17841400000000099',
        accessToken: token,
        expiresAt: new Date(Date.now() + 60 * day),
      }),
    ).rejects.toThrow('includes one channel');
    await expect(setWebChatEnabled(shop.actor, true)).rejects.toThrow('includes one channel');
    // Reconnecting the same channel is fine.
    await ch.saveWhatsAppConnection(shop.actor, {
      phoneNumberId: phoneId(),
      businessAccountId: '987654321012345',
      accessToken: token,
    });

    await ent.setBusinessEntitlement(shop.business.id, 'owner_alerts', {
      enabled: true,
      note: 'pilot',
    });
    expect(await ent.canUse(shop.business.id, 'owner_alerts')).toBe(true);
    await ent.setBusinessEntitlement(shop.business.id, 'owner_alerts', { enabled: null });
    expect(await ent.canUse(shop.business.id, 'owner_alerts')).toBe(false);
  });
});

describe('assistant conversations a month', () => {
  it('each chat counts once a month; warnings at 80% and 100%; over the limit the team answers', async () => {
    const shop = await newBusiness('bill-usage');
    await ent.setBusinessEntitlement(shop.business.id, 'agent.conversations', { limitValue: 5 });
    const chats = Array.from({ length: 6 }, () => randomUUID());
    for (const id of chats.slice(0, 3))
      expect(await claimAgentConversation(shop.business.id, id)).toMatchObject({ allowed: true });
    // The same chat again (more messages) is not counted again.
    expect(await claimAgentConversation(shop.business.id, chats[0]!)).toMatchObject({
      allowed: true,
      used: 3,
    });
    expect(await claimAgentConversation(shop.business.id, chats[3]!)).toMatchObject({
      allowed: true,
      used: 4,
    });
    expect(await claimAgentConversation(shop.business.id, chats[4]!)).toMatchObject({
      allowed: true,
      used: 5,
    });
    expect(await claimAgentConversation(shop.business.id, chats[5]!)).toEqual({
      allowed: false,
      used: 5,
      limit: 5,
      reason: 'Monthly assistant limit reached',
    });
    // Chats already counted this month carry on.
    expect(await claimAgentConversation(shop.business.id, chats[1]!)).toMatchObject({
      allowed: true,
    });
    expect(await conversationUsage(shop.business.id)).toMatchObject({ used: 5, limit: 5 });

    const warnings = (await listEvents(shop.actor)).filter((e) => e.type === 'usage.limit');
    expect(warnings.map((e) => e.payload.percent).sort()).toEqual([100, 80]);

    // A new month starts again.
    const nextMonth = new Date(Date.now() + 32 * day);
    await setSub(shop.business.id, { trialEndsAt: new Date(Date.now() + 40 * day) });
    expect(await claimAgentConversation(shop.business.id, chats[5]!, nextMonth)).toMatchObject({
      allowed: true,
      used: 1,
    });
  });
});
