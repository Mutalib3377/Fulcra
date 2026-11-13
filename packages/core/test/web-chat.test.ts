import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as QueueModule from '../src/jobs/queue';

const inbound: { businessId: string; connectionId: string; message: Record<string, unknown> }[] =
  [];
vi.mock('../src/jobs/queue', async (original) => ({
  ...(await original<typeof QueueModule>()),
  enqueueInboundMessage: async (
    businessId: string,
    connectionId: string,
    message: Record<string, unknown>,
  ) => {
    inbound.push({ businessId, connectionId, message });
  },
  enqueueSendMessage: async () => {},
}));

const { schema, withTenant } = await import('@fulcra/db');
const { eq } = await import('drizzle-orm');
const w = await import('../src/conversations/web-chat');
const rules = await import('../src/conversations/web-chat-rules');
const { receiveInboundMessage, sendHumanReply, getConversation } =
  await import('../src/conversations/conversations');
const { saveAgentSettings } = await import('../src/agent/settings');
const a = await import('../src/agent/assistant');
const { createOrder } = await import('../src/orders/orders');
const { addMember, newBusiness, shopWithStock } = await import('./helpers');

beforeEach(() => {
  inbound.length = 0;
});

const visitor = () => `v_${randomUUID().replace(/-/g, '')}`;

/** A visitor writes through the widget; the worker stores it (as the queue would). */
async function visitorSays(key: string, visitorId: string, text: string) {
  expect(await w.sendWidgetMessage(key, { visitorId, messageId: randomUUID(), text })).toBe(true);
  const job = inbound.at(-1)!;
  return (await receiveInboundMessage(job.businessId, job.connectionId, job.message as never)) as {
    conversationId: string;
    messageId: string;
  };
}

describe('turning the website chat on', () => {
  it('owner only; one key per business, kept when turned off and on', async () => {
    const shop = await newBusiness('web');
    expect(await w.getWebChat(shop.actor)).toBeNull();
    const staff = await addMember(shop.actor, 'staff');
    await expect(w.setWebChatEnabled(staff, true)).rejects.toThrow();
    const on = await w.setWebChatEnabled(shop.actor, true);
    expect(on).toMatchObject({ enabled: true, key: expect.stringMatching(rules.WIDGET_KEY) });
    const off = await w.setWebChatEnabled(shop.actor, false);
    expect(off).toMatchObject({ enabled: false, key: on!.key });
    expect(await w.getWidgetConfig(on!.key)).toBeNull(); // switched off
    expect(
      await w.sendWidgetMessage(on!.key, {
        visitorId: visitor(),
        messageId: 'abcdefgh',
        text: 'hi',
      }),
    ).toBe(false);
    expect((await w.setWebChatEnabled(shop.actor, true))!.key).toBe(on!.key);
    expect(await w.getWebChat(staff)).toMatchObject({ enabled: true });
  });

  it('the widget shows the business name, colour and greeting', async () => {
    const shop = await newBusiness('web-cfg');
    const { key } = (await w.setWebChatEnabled(shop.actor, true))!;
    const config = await w.getWidgetConfig(key);
    expect(config).toMatchObject({
      businessName: shop.business.name,
      colour: expect.stringMatching(/^#[0-9a-f]{6}$/i),
      greeting: expect.stringContaining(shop.business.name),
      websiteHost: null,
    });
    await saveAgentSettings(shop.actor, { enabled: false, greeting: 'Welcome to Ada!' });
    expect((await w.getWidgetConfig(key))!.greeting).toBe('Welcome to Ada!');
    expect(await w.getWidgetConfig('wk_' + 'x'.repeat(24))).toBeNull();
    expect(await w.getWidgetConfig('nonsense')).toBeNull();
  });
});

describe('only allowed websites', () => {
  it('any site without a saved website; otherwise the site, its subdomains, the store and local', () => {
    const open = { websiteHost: null, storeHost: 'ada.yourdomain.com', allowLocal: false };
    expect(rules.isAllowedWidgetOrigin('https://anything.com', open)).toBe(true);
    const site = {
      websiteHost: 'www.adastyles.com',
      storeHost: 'ada.yourdomain.com',
      allowLocal: false,
    };
    expect(rules.isAllowedWidgetOrigin('https://adastyles.com', site)).toBe(true);
    expect(rules.isAllowedWidgetOrigin('https://shop.adastyles.com', site)).toBe(true);
    expect(rules.isAllowedWidgetOrigin('https://ada.yourdomain.com', site)).toBe(true);
    expect(rules.isAllowedWidgetOrigin('https://evil.com', site)).toBe(false);
    expect(rules.isAllowedWidgetOrigin('https://adastyles.com.evil.com', site)).toBe(false);
    expect(rules.isAllowedWidgetOrigin(null, site)).toBe(false);
    expect(rules.isAllowedWidgetOrigin('http://localhost:8080', site)).toBe(false);
    expect(
      rules.isAllowedWidgetOrigin('http://localhost:8080', { ...site, allowLocal: true }),
    ).toBe(true);
  });
});

describe('visitor chats', () => {
  it('arrive in the inbox like any channel; the widget gets its chat back, nothing else', async () => {
    const shop = await newBusiness('web-chat');
    const { key } = (await w.setWebChatEnabled(shop.actor, true))!;
    const me = visitor();
    expect(await w.getWidgetMessages(key, { visitorId: me })).toEqual({
      messages: [],
      replying: false,
    });
    const r = await visitorSays(key, me, 'Do you deliver to Ikeja?');
    const view = await getConversation(shop.actor, r.conversationId);
    expect(view.conversation.channel).toBe('web');
    expect(view.customer.phone).toBeNull();

    await sendHumanReply(shop.actor, r.conversationId, { text: 'Yes, ₦2,000.' });
    const [reply] = (await getConversation(shop.actor, r.conversationId)).messages.filter(
      (m) => m.direction === 'outbound',
    );
    await withTenant(shop.business.id, (tx) =>
      tx.update(schema.messages).set({ status: 'sent' }).where(eq(schema.messages.id, reply!.id)),
    );
    const chat = (await w.getWidgetMessages(key, { visitorId: me, seen: true }))!;
    expect(chat.messages.map((m) => [m.from, m.text])).toEqual([
      ['visitor', 'Do you deliver to Ikeja?'],
      ['shop', 'Yes, ₦2,000.'],
    ]);
    expect(chat.messages[0]!.clientId).toMatch(/^[0-9a-f-]{36}$/);
    const [read] = await withTenant(shop.business.id, (tx) =>
      tx.select().from(schema.messages).where(eq(schema.messages.id, reply!.id)),
    );
    expect(read!.status).toBe('read');

    // Only newer messages after the cursor; another visitor sees nothing.
    expect(
      (await w.getWidgetMessages(key, { visitorId: me, after: chat.messages[1]!.createdAt }))!
        .messages,
    ).toEqual([]);
    expect((await w.getWidgetMessages(key, { visitorId: visitor() }))!.messages).toEqual([]);
    // A key of another business cannot read this chat.
    const other = await newBusiness('web-other');
    const otherKey = (await w.setWebChatEnabled(other.actor, true))!.key;
    expect((await w.getWidgetMessages(otherKey, { visitorId: me }))!.messages).toEqual([]);
    await expect(w.getWidgetMessages(key, { visitorId: 'bad id!' })).rejects.toThrow();
  });

  it('a message sent twice (slow network) is saved once', async () => {
    const shop = await newBusiness('web-dup');
    const { key } = (await w.setWebChatEnabled(shop.actor, true))!;
    const me = visitor();
    const input = { visitorId: me, messageId: randomUUID(), text: 'Hello' };
    await w.sendWidgetMessage(key, input);
    await w.sendWidgetMessage(key, input);
    for (const job of inbound)
      await receiveInboundMessage(job.businessId, job.connectionId, job.message as never);
    expect((await w.getWidgetMessages(key, { visitorId: me }))!.messages).toHaveLength(1);
  });
});

describe('saving the customer’s details', () => {
  it('saves name and phone; a known number links the chat to that customer and their orders', async () => {
    const shop = await shopWithStock(5);
    await saveAgentSettings(shop.actor, { enabled: true });
    const { key } = (await w.setWebChatEnabled(shop.actor, true))!;

    // A known customer with an order (from WhatsApp, the dashboard…).
    const { order } = await createOrder(shop.actor, {
      customer: { name: 'Chioma Obi', phone: '0803 123 4567' },
      items: [{ variantId: shop.variant.id, quantity: 1 }],
      fulfilment: 'pickup',
    });

    const me = visitor();
    const r = await visitorSays(key, me, 'I want to order again');
    await expect(
      a.assistantSaveCustomerDetails(shop.business.id, r.conversationId, { phone: '12' }),
    ).rejects.toThrow('does not look right');
    const result = await a.assistantSaveCustomerDetails(shop.business.id, r.conversationId, {
      name: 'Chioma',
      phone: '0803 123 4567',
    });
    expect(result).toEqual({
      saved: true,
      name: 'Chioma Obi',
      phone: '+2348031234567',
      knownCustomer: true,
      pastOrders: 1,
    });
    const view = await getConversation(shop.actor, r.conversationId);
    expect(view.customer.id).toBe(order.customerId);
    // The visitor keeps their chat (same browser id → same customer now).
    const again = await visitorSays(key, me, 'Same as last time');
    expect(again.conversationId).toBe(r.conversationId);

    // A new number is simply saved on the visitor.
    const you = visitor();
    const r2 = await visitorSays(key, you, 'Hi');
    expect(
      await a.assistantSaveCustomerDetails(shop.business.id, r2.conversationId, {
        name: 'Bola',
        phone: '0805 000 1111',
      }),
    ).toMatchObject({ name: 'Bola', phone: '+2348050001111', knownCustomer: false, pastOrders: 0 });
  });
});
