import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as QueueModule from '../src/jobs/queue';

const sent: string[] = [];
const submitted: string[] = [];
vi.mock('../src/jobs/queue', async (original) => ({
  ...(await original<typeof QueueModule>()),
  enqueueSendMessage: async (_b: string, id: string) => {
    sent.push(id);
  },
  enqueueSubmitTemplates: async (_b: string, connectionId: string) => {
    submitted.push(connectionId);
  },
}));

const { schema, withTenant } = await import('@fulcra/db');
const { eq } = await import('drizzle-orm');
const t = await import('../src/conversations/templates');
const ch = await import('../src/conversations/channels');
const { receiveInboundMessage, getConversation } =
  await import('../src/conversations/conversations');
const { createOrder, markOrderPaid, updateOrderStatus } = await import('../src/orders/orders');
const { setPaystackClient } = await import('../src/payments/paystack');
const { savePayoutAccount } = await import('../src/payments/payout');
const { FakePaystack } = await import('../src/testing/fake-paystack');
const { addMember, newBusiness, shopWithStock } = await import('./helpers');

beforeEach(() => {
  sent.length = 0;
  submitted.length = 0;
  setPaystackClient(new FakePaystack());
});
afterEach(() => setPaystackClient(null));

const phoneId = () => String(100_000_000_000 + Math.floor(Math.random() * 1e11));
const wabaId = () => String(200_000_000_000 + Math.floor(Math.random() * 1e11));
const token = 'EAAG' + 'x'.repeat(40);

async function connectedShop() {
  const shop = await shopWithStock(10);
  const waba = wabaId();
  const connection = await ch.saveWhatsAppConnection(shop.actor, {
    phoneNumberId: phoneId(),
    businessAccountId: waba,
    accessToken: token,
    pin: '123456',
  });
  return { ...shop, connection, waba };
}

async function customerWrites(shop: Awaited<ReturnType<typeof connectedShop>>, text = 'Hello') {
  return (await receiveInboundMessage(shop.business.id, shop.connection.id, {
    externalId: `wamid.${randomUUID()}`,
    from: { externalUserId: '2348031234567', displayName: 'Chioma Obi' },
    sentAt: new Date().toISOString(),
    type: 'text',
    text,
  })) as { conversationId: string; messageId: string };
}

async function submitAndApprove(shop: Awaited<ReturnType<typeof connectedShop>>, approve = true) {
  const todo = (await t.templatesToSubmit(shop.business.id, shop.connection.id))!;
  for (const [i, tpl] of todo.templates.entries()) {
    const externalId = `${shop.waba}${i}`;
    await t.saveTemplateSubmission(shop.business.id, tpl.id, { externalId, status: 'PENDING' });
    if (approve)
      await t.applyTemplateStatusUpdate('whatsapp', {
        businessAccountId: shop.waba,
        externalId,
        name: tpl.name,
        language: 'en',
        status: 'APPROVED',
      });
  }
}

const outbound = async (businessId: string, conversationId: string) =>
  withTenant(businessId, (tx) =>
    tx
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, conversationId))
      .orderBy(schema.messages.createdAt),
  ).then((rows) => rows.filter((r) => r.direction === 'outbound'));

const closeWindow = (businessId: string, conversationId: string) =>
  withTenant(businessId, (tx) =>
    tx
      .update(schema.conversations)
      .set({ lastCustomerMessageAt: new Date(Date.now() - 2 * 86_400_000) })
      .where(eq(schema.conversations.id, conversationId)),
  );

describe('templates', () => {
  it('fills values in and cleans what WhatsApp refuses', () => {
    expect(t.renderTemplate('Hi {{1}}, order {{2}}.', ['Chioma', '#1001'])).toBe(
      'Hi Chioma, order #1001.',
    );
    expect(t.templateParam(' Ada\nStyles\t  ')).toBe('Ada Styles');
    expect(t.templateParam('a      b')).toBe('a   b');
    expect(t.templateParam('')).toBe('-');
    for (const tpl of Object.values(t.STARTER_TEMPLATES)) {
      expect(tpl.body.startsWith('{{')).toBe(false);
      expect(tpl.body.trimEnd().endsWith('}}')).toBe(false);
      expect(tpl.body.match(/\{\{\d+\}\}/g)!.length).toBe(tpl.examples.length);
    }
  });

  it('a connected number gets the starter set, sent to Meta, then approved or rejected by webhook', async () => {
    const shop = await connectedShop();
    expect(submitted).toEqual([shop.connection.id]);
    const list = await t.listMessageTemplates(shop.actor);
    expect(list.map((x) => [x.purpose, x.status])).toEqual(
      t.TEMPLATE_PURPOSES.map((p) => [p, 'not_submitted']),
    );
    expect(list[1]!.label).toBe('Payment received');
    expect(list[0]!.example).toBe(
      'Hi Chioma, thank you for your order #1024 from Ada Styles. Your total is ₦17,000.00. We will let you know when it is on its way.',
    );

    const todo = (await t.templatesToSubmit(shop.business.id, shop.connection.id))!;
    expect(todo.businessAccountId).toBe(shop.waba);
    expect(JSON.parse(todo.credentials!)).toEqual({ accessToken: token, pin: '123456' });
    expect(todo.templates).toHaveLength(5);
    expect(todo.templates[0]!.examples).toEqual(['Chioma', '#1024', 'Ada Styles', '₦17,000.00']);

    await t.saveTemplateSubmission(shop.business.id, todo.templates[0]!.id, {
      externalId: '555',
      status: 'PENDING',
    });
    await t.saveTemplateSubmission(shop.business.id, todo.templates[1]!.id, {
      externalId: '556',
      status: 'PENDING',
    });
    expect(
      await t.applyTemplateStatusUpdate('whatsapp', {
        businessAccountId: shop.waba,
        externalId: '555',
        status: 'APPROVED',
      }),
    ).toBe(1);
    expect(
      await t.applyTemplateStatusUpdate('whatsapp', {
        businessAccountId: shop.waba,
        externalId: '556',
        status: 'REJECTED',
        reason: 'INVALID_FORMAT',
      }),
    ).toBe(1);
    // Another account's update changes nothing here.
    expect(
      await t.applyTemplateStatusUpdate('whatsapp', {
        businessAccountId: wabaId(),
        externalId: '555',
        status: 'DISABLED',
      }),
    ).toBe(0);
    const after = await t.listMessageTemplates(shop.actor);
    expect(after.slice(0, 2).map((x) => [x.status, x.statusReason])).toEqual([
      ['approved', null],
      ['rejected', 'invalid format'],
    ]);
    expect(
      (await t.templatesToSubmit(shop.business.id, shop.connection.id))!.templates,
    ).toHaveLength(3);

    // Connecting a number from another WhatsApp Business Account starts again.
    await ch.saveWhatsAppConnection(shop.actor, {
      phoneNumberId: phoneId(),
      businessAccountId: wabaId(),
      accessToken: token,
    });
    expect(
      (await t.listMessageTemplates(shop.actor)).every((x) => x.status === 'not_submitted'),
    ).toBe(true);

    const rider = await addMember(shop.actor, 'rider');
    await expect(t.listMessageTemplates(rider)).rejects.toThrow();
  });
});

describe('automatic customer messages', () => {
  it('order confirmation as a normal message while the chat is open, once per event', async () => {
    const shop = await connectedShop();
    const chat = await customerWrites(shop);
    const { order } = await createOrder(shop.actor, {
      customer: { name: 'Chioma Obi', phone: '0803 123 4567' },
      items: [{ variantId: shop.variant.id, quantity: 1 }],
      fulfilment: 'pickup',
    });
    const connectedAt = new Date(Date.now() - 60_000);
    const pending = await t.pendingCustomerNotifications(shop.business.id, connectedAt);
    expect(pending).toHaveLength(1);
    expect(await t.sendCustomerNotification(shop.business.id, pending[0]!)).toBe('queued');
    expect(await t.sendCustomerNotification(shop.business.id, pending[0]!)).toBe('skipped');
    expect(await t.pendingCustomerNotifications(shop.business.id, connectedAt)).toEqual([]);

    const [message] = await outbound(shop.business.id, chat.conversationId);
    expect(message).toMatchObject({
      sender: 'system',
      status: 'queued',
      text: `Hi Chioma, thank you for your order #${order.orderNumber} from ${shop.business.name}. Your total is ₦15,000.00. We will let you know when it is on its way.`,
    });
    expect(message!.payload).toMatchObject({ purpose: 'order_confirmation' });
    expect(message!.payload.template).toBeUndefined();
    expect(sent).toEqual([message!.id]);

    // Nothing for events from before the number was connected.
    expect(
      await t.pendingCustomerNotifications(shop.business.id, new Date(Date.now() + 1000)),
    ).toEqual([]);
  });

  it('after 24 hours: waits for the approved template, then sends the receipt as a template', async () => {
    const shop = await connectedShop();
    const chat = await customerWrites(shop);
    const { order } = await createOrder(shop.actor, {
      customer: { name: 'Chioma Obi', phone: '0803 123 4567' },
      items: [{ variantId: shop.variant.id, quantity: 1 }],
      fulfilment: 'delivery',
      deliveryZoneId: shop.zone.id,
      deliveryAddress: '12 Admiralty Way',
    });
    await closeWindow(shop.business.id, chat.conversationId);
    await markOrderPaid(shop.actor, order.id, { method: 'cash' });
    const since = new Date(Date.now() - 60_000);
    const pending = await t.pendingCustomerNotifications(shop.business.id, since);
    expect(pending).toHaveLength(2); // order created + paid
    for (const id of pending)
      expect(await t.sendCustomerNotification(shop.business.id, id)).toBe('waiting_for_template');
    expect(await t.pendingCustomerNotifications(shop.business.id, since)).toHaveLength(2);

    await submitAndApprove(shop);
    for (const id of pending)
      expect(await t.sendCustomerNotification(shop.business.id, id)).toBe('queued');
    const messages = await outbound(shop.business.id, chat.conversationId);
    const receipt = messages.find((x) => x.payload.purpose === 'payment_receipt')!;
    expect(receipt.payload.template).toMatchObject({
      name: 'fulcra_payment_receipt_v1',
      language: 'en',
      params: [
        'Chioma',
        '₦17,000.00',
        `#${order.orderNumber}`,
        shop.business.name,
        expect.stringMatching(/\/receipt\/.+/),
      ],
    });
    expect(receipt.text).toContain('we have received your payment of ₦17,000.00');

    // Sent out, then delivered: two updates. A cancelled order would send nothing.
    await updateOrderStatus(shop.actor, order.id, 'dispatched');
    await updateOrderStatus(shop.actor, order.id, 'delivered');
    for (const id of await t.pendingCustomerNotifications(shop.business.id, since))
      await t.sendCustomerNotification(shop.business.id, id);
    const updates = (await outbound(shop.business.id, chat.conversationId)).filter(
      (x) => x.payload.purpose === 'order_update',
    );
    expect(updates.map((x) => (x.payload.template as { params: string[] }).params[3])).toEqual([
      'it is on its way to you',
      'it has been delivered',
    ]);
  });

  it('customers who never wrote on WhatsApp get nothing', async () => {
    const shop = await connectedShop();
    await createOrder(shop.actor, {
      customer: { name: 'Bola', phone: '0805 000 1111' },
      items: [{ variantId: shop.variant.id, quantity: 1 }],
      fulfilment: 'pickup',
    });
    expect(
      await t.pendingCustomerNotifications(shop.business.id, new Date(Date.now() - 60_000)),
    ).toEqual([]);
  });
});

describe('templates from the inbox', () => {
  it('only approved ones; a payment reminder gets a fresh payment link; the team takes over', async () => {
    const shop = await connectedShop();
    await savePayoutAccount(shop.actor, { bankCode: '058', accountNumber: '0123456789' });
    const chat = await customerWrites(shop);
    await closeWindow(shop.business.id, chat.conversationId);

    let options = await t.inboxTemplateOptions(shop.actor, chat.conversationId);
    expect(options.map((o) => [o.purpose, o.available, o.reason])).toEqual([
      ['reply_request', false, 'Waiting for WhatsApp to approve this message.'],
      ['payment_reminder', false, 'Waiting for WhatsApp to approve this message.'],
    ]);
    await expect(
      t.sendInboxTemplate(shop.actor, chat.conversationId, 'reply_request'),
    ).rejects.toThrow('Waiting for WhatsApp');

    await submitAndApprove(shop);
    options = await t.inboxTemplateOptions(shop.actor, chat.conversationId);
    expect(options[0]).toMatchObject({ available: true, reason: null });
    expect(options[0]!.preview).toBe(
      `Hi Chioma, this is ${shop.business.name} following up on your message. Please reply to this message so we can continue our chat.`,
    );
    expect(options[1]).toMatchObject({
      available: false,
      reason: 'This customer has no unpaid order.',
    });

    await t.sendInboxTemplate(shop.actor, chat.conversationId, 'reply_request');
    const { order } = await createOrder(shop.actor, {
      customer: { name: 'Chioma Obi', phone: '0803 123 4567' },
      items: [{ variantId: shop.variant.id, quantity: 1 }],
      fulfilment: 'pickup',
    });
    await t.sendInboxTemplate(shop.actor, chat.conversationId, 'payment_reminder');

    const view = await getConversation(shop.actor, chat.conversationId);
    expect(view.conversation.handledBy).toBe('human');
    const [ask, reminder] = view.messages.filter((x) => x.direction === 'outbound');
    expect(ask).toMatchObject({ sender: 'human', status: 'queued' });
    expect(reminder!.payload.template).toMatchObject({
      name: 'fulcra_payment_reminder_v1',
      params: [
        'Chioma',
        `#${order.orderNumber}`,
        shop.business.name,
        '₦15,000.00',
        expect.stringMatching(/^https:\/\//),
      ],
    });
    expect(sent).toHaveLength(2);

    const other = await newBusiness('tpl-other');
    await expect(t.inboxTemplateOptions(other.actor, chat.conversationId)).rejects.toThrow();
  });
});
