import { describe, expect, it, vi } from 'vitest';
import type * as QueueModule from '../src/jobs/queue';

const inbound: { businessId: string; connectionId: string; message: unknown }[] = [];
vi.mock('../src/jobs/queue', async (original) => ({
  ...(await original<typeof QueueModule>()),
  enqueueInboundMessage: async (businessId: string, connectionId: string, message: unknown) => {
    inbound.push({ businessId, connectionId, message });
  },
  enqueueSendMessage: async () => {},
}));

const { schema, withTenant } = await import('@fulcra/db');
const { getHomeSummary } = await import('../src/businesses/home');
const { createOrder, markOrderPaid } = await import('../src/orders/orders');
const { receiveInboundMessage, sendTestCustomerMessage } =
  await import('../src/conversations/conversations');
const { saveBrandKit } = await import('../src/brand-kit/brand-kit');
const { addMember, newBusiness, shopWithStock } = await import('./helpers');

const stepsDone = (s: Awaited<ReturnType<typeof getHomeSummary>>) =>
  s.setup!.steps.filter((x) => x.done).map((x) => x.key);

describe('getHomeSummary', () => {
  it('a new business has only its store ready', async () => {
    const { actor } = await newBusiness('home');
    const summary = await getHomeSummary(actor);
    expect(stepsDone(summary)).toEqual(['store']);
    expect(summary.setup).toMatchObject({ done: 1, total: 7 });
    expect(summary.today).toEqual({ orders: 0, amount: 0 });
    expect(summary.chatsWaiting).toBe(0);
  });

  it('ticks each step from the business data', async () => {
    const shop = await shopWithStock(5);
    const { actor } = shop;
    await saveBrandKit(actor, {
      logo: null,
      primaryColour: '#112233',
      accentColour: '#445566',
      font: 'elegant',
      voice: 'friendly',
      description: '',
    });
    await withTenant(actor.businessId, async (tx) => {
      await tx.update(schema.businesses).set({ paystackSubaccountCode: 'ACCT_home' });
      await tx.insert(schema.channelConnections).values({
        businessId: actor.businessId,
        channel: 'web',
        mode: 'live',
        externalAccountId: `wk_home_${actor.businessId}`,
        displayName: 'Website chat',
        connectedBy: actor.userId,
      });
    });
    expect(stepsDone(await getHomeSummary(actor))).toEqual([
      'store',
      'brand',
      'products',
      'delivery',
      'payouts',
      'channel',
    ]);

    // Test chat counts once the assistant has answered.
    await sendTestCustomerMessage(actor, { text: 'How much is the Ankara dress?' });
    const queued = inbound.find((m) => m.businessId === actor.businessId)!;
    const received = await receiveInboundMessage(
      actor.businessId,
      queued.connectionId,
      queued.message as Parameters<typeof receiveInboundMessage>[2],
    );
    if (received.status !== 'saved') throw new Error('not received');
    expect((await getHomeSummary(actor)).setup!.done).toBe(6);
    await withTenant(actor.businessId, (tx) =>
      tx.insert(schema.messages).values({
        businessId: actor.businessId,
        conversationId: received.conversationId,
        direction: 'outbound',
        sender: 'agent',
        type: 'text',
        text: 'It is ₦15,000.',
        status: 'queued',
      }),
    );
    expect((await getHomeSummary(actor)).setup).toMatchObject({ done: 7, total: 7 });
  });

  it('website sellers finish the store step by adding their address', async () => {
    const { actor } = await newBusiness('site');
    await withTenant(actor.businessId, (tx) =>
      tx.update(schema.businesses).set({ hasExternalWebsite: true }),
    );
    expect(stepsDone(await getHomeSummary(actor))).toEqual([]);
    await withTenant(actor.businessId, (tx) =>
      tx.update(schema.businesses).set({ websiteUrl: 'https://example.com' }),
    );
    expect(stepsDone(await getHomeSummary(actor))).toEqual(['store']);
  });

  it("counts today's paid orders and leaves out unpaid and other days", async () => {
    const shop = await shopWithStock(10);
    const order = async () =>
      (
        await createOrder(shop.actor, {
          customer: { name: 'Chioma Obi', phone: '0805 111 2222' },
          items: [{ variantId: shop.variant.id, quantity: 1 }],
          fulfilment: 'pickup',
        })
      ).order;
    const paid = await order();
    await markOrderPaid(shop.actor, paid.id, { method: 'cash' });
    await order(); // unpaid
    const yesterday = await order();
    await markOrderPaid(shop.actor, yesterday.id, { method: 'cash' });
    await withTenant(shop.business.id, async (tx) => {
      const { eq } = await import('drizzle-orm');
      await tx
        .update(schema.orders)
        .set({ paidAt: new Date(Date.now() - 2 * 24 * 3600_000) })
        .where(eq(schema.orders.id, yesterday.id));
    });
    const summary = await getHomeSummary(shop.actor);
    expect(summary.today).toEqual({ orders: 1, amount: paid.total });
  });

  it('riders see sales but no checklist or chats', async () => {
    const { actor } = await newBusiness('rider');
    const rider = await addMember(actor, 'rider');
    const summary = await getHomeSummary(rider);
    expect(summary.setup).toBeNull();
    expect(summary.chatsWaiting).toBeNull();
  });
});
