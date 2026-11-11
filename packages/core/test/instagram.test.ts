import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as QueueModule from '../src/jobs/queue';

const sent: string[] = [];
vi.mock('../src/jobs/queue', async (original) => ({
  ...(await original<typeof QueueModule>()),
  enqueueSendMessage: async (_b: string, id: string) => {
    sent.push(id);
  },
  enqueueSubmitTemplates: async () => {},
}));

const { schema, withSystem, withTenant } = await import('@fulcra/db');
const { eq } = await import('drizzle-orm');
const ch = await import('../src/conversations/channels');
const t = await import('../src/conversations/templates');
const { receiveInboundMessage } = await import('../src/conversations/conversations');
const { createOrder } = await import('../src/orders/orders');
const { createSignedState, readSignedState } = await import('../src/shared/signed-state');
const { addMember, newBusiness, shopWithStock } = await import('./helpers');

beforeEach(() => {
  sent.length = 0;
});

const igId = () => `1784${String(Math.floor(Math.random() * 1e12)).padStart(12, '0')}`;
const token = 'IGQV' + 'x'.repeat(40);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000);

async function connectedShop() {
  const shop = await shopWithStock(10);
  const accountId = igId();
  const connection = await ch.saveInstagramConnection(shop.actor, {
    accountId,
    username: 'adastyles',
    accessToken: token,
    expiresAt: inDays(60),
  });
  return { ...shop, accountId, connection };
}

describe('connecting Instagram', () => {
  it('owner only; token encrypted with its expiry; one business per account', async () => {
    const shop = await connectedShop();
    expect(shop.connection).toMatchObject({ channel: 'instagram', displayName: '@adastyles' });
    const found = await ch.findConnectionByAccount('instagram', shop.accountId);
    expect(found).toMatchObject({ businessId: shop.business.id, mode: 'live' });
    expect(JSON.parse(found!.credentials!)).toEqual({ accessToken: token });
    const [row] = await withSystem((tx) =>
      tx
        .select()
        .from(schema.channelConnections)
        .where(eq(schema.channelConnections.id, shop.connection.id)),
    );
    expect(row!.credentials).not.toContain(token);
    expect(row!.expiresAt!.getTime()).toBeGreaterThan(inDays(59).getTime());

    const staff = await addMember(shop.actor, 'staff');
    await expect(
      ch.saveInstagramConnection(staff, {
        accountId: igId(),
        accessToken: token,
        expiresAt: inDays(60),
      }),
    ).rejects.toThrow();
    const other = await newBusiness('ig-other');
    await expect(
      ch.saveInstagramConnection(other.actor, {
        accountId: shop.accountId,
        accessToken: token,
        expiresAt: inDays(60),
      }),
    ).rejects.toThrow('already connected to another Fulcra business');
    expect((await ch.listChannelConnections(shop.actor)).map((c) => c.channel)).toEqual([
      'instagram',
    ]);
  });

  it('DMs arrive like any other channel (no phone number, photo link kept)', async () => {
    const shop = await connectedShop();
    const r = (await receiveInboundMessage(shop.business.id, shop.connection.id, {
      externalId: `ig.${randomUUID()}`,
      from: { externalUserId: '9001', displayName: 'Chioma Obi' },
      sentAt: new Date().toISOString(),
      type: 'image',
      text: '',
      media: { url: 'https://lookaside.example/p.jpg?sig=1' },
    })) as { conversationId: string; messageId: string };
    const [message] = await withTenant(shop.business.id, (tx) =>
      tx.select().from(schema.messages).where(eq(schema.messages.id, r.messageId)),
    );
    expect(message!.media).toMatchObject({ url: 'https://lookaside.example/p.jpg?sig=1' });
    const [conversation] = await withTenant(shop.business.id, (tx) =>
      tx.select().from(schema.conversations).where(eq(schema.conversations.id, r.conversationId)),
    );
    expect(conversation!.channel).toBe('instagram');
  });
});

describe('renewing Instagram tokens', () => {
  it('lists tokens near their end (and at least a day old), renews them, flags run-out ones', async () => {
    const shop = await connectedShop();
    const setRow = (values: Partial<typeof schema.channelConnections.$inferInsert>) =>
      withTenant(shop.business.id, (tx) =>
        tx
          .update(schema.channelConnections)
          .set(values)
          .where(eq(schema.channelConnections.id, shop.connection.id)),
      );
    const listed = async (now = new Date()) =>
      (await ch.instagramTokensToRefresh(now)).some((r) => r.connectionId === shop.connection.id);

    expect(await listed()).toBe(false); // 60 days left
    // Ten days left, saved two days ago.
    await setRow({ expiresAt: inDays(10) });
    await withSystem((tx) =>
      tx
        .update(schema.channelConnections)
        .set({ updatedAt: inDays(-2) })
        .where(eq(schema.channelConnections.id, shop.connection.id)),
    );
    expect(await listed()).toBe(true);
    expect(await ch.connectionToken(shop.business.id, shop.connection.id)).toBe(token);
    await ch.saveRenewedToken(shop.business.id, shop.connection.id, {
      accessToken: 'IGQVnew' + 'y'.repeat(30),
      expiresAt: inDays(60),
    });
    expect(await listed()).toBe(false);
    expect(await ch.connectionToken(shop.business.id, shop.connection.id)).toBe(
      'IGQVnew' + 'y'.repeat(30),
    );

    // Already run out: cannot be renewed; the owner is asked to connect again.
    await setRow({ expiresAt: inDays(-1) });
    expect(await ch.connectionToken(shop.business.id, shop.connection.id)).toBeNull();
    const [view] = await ch.listChannelConnections(shop.actor);
    expect(view).toMatchObject({
      status: 'error',
      lastError: expect.stringContaining('Connect Instagram again'),
    });
  });
});

describe('automatic messages to Instagram customers', () => {
  it('sent while the chat is open; no templates afterwards', async () => {
    const shop = await connectedShop();
    const r = (await receiveInboundMessage(shop.business.id, shop.connection.id, {
      externalId: `ig.${randomUUID()}`,
      from: { externalUserId: '9001', displayName: 'Chioma Obi' },
      sentAt: new Date().toISOString(),
      type: 'text',
      text: 'I want the dress',
    })) as { conversationId: string };
    const [conversation] = await withTenant(shop.business.id, (tx) =>
      tx.select().from(schema.conversations).where(eq(schema.conversations.id, r.conversationId)),
    );
    const customerId = conversation!.customerId;
    expect((await t.businessesWithMessaging()).map((b) => b.businessId)).toContain(
      shop.business.id,
    );

    const order = async () =>
      createOrder(shop.actor, {
        customer: { id: customerId },
        items: [{ variantId: shop.variant.id, quantity: 1 }],
        fulfilment: 'pickup',
      });
    await order();
    const since = new Date(Date.now() - 60_000);
    const [first] = await t.pendingCustomerNotifications(shop.business.id, since);
    expect(await t.sendCustomerNotification(shop.business.id, first!)).toBe('queued');
    const [message] = await withTenant(shop.business.id, (tx) =>
      tx.select().from(schema.messages).where(eq(schema.messages.conversationId, r.conversationId)),
    ).then((rows) => rows.filter((m) => m.direction === 'outbound'));
    expect(message!.text).toContain('thank you for your order');
    expect(message!.payload.template).toBeUndefined();

    // 24 hours later Instagram allows nothing: it waits (and is never sent as a template).
    await withTenant(shop.business.id, (tx) =>
      tx
        .update(schema.conversations)
        .set({ lastCustomerMessageAt: inDays(-2) })
        .where(eq(schema.conversations.id, r.conversationId)),
    );
    await order();
    const [second] = await t.pendingCustomerNotifications(shop.business.id, since);
    expect(await t.sendCustomerNotification(shop.business.id, second!)).toBe(
      'waiting_for_template',
    );
  });
});

describe('signed login state', () => {
  it('reads back what was signed; refuses tampering and old states', () => {
    const { state, nonce } = createSignedState({ businessId: 'b1', userId: 'u1' }, 'secret');
    expect(readSignedState(state, 'secret')).toMatchObject({
      businessId: 'b1',
      userId: 'u1',
      nonce,
    });
    expect(readSignedState(state, 'other')).toBeNull();
    expect(readSignedState(state.replace(/^./, 'x'), 'secret')).toBeNull();
    expect(readSignedState(state, 'secret', Date.now() + 11 * 60_000)).toBeNull();
    expect(readSignedState('nonsense', 'secret')).toBeNull();
  });
});
