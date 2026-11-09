import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as QueueModule from '../src/jobs/queue';

const sent: string[] = [];
vi.mock('../src/jobs/queue', async (original) => ({
  ...(await original<typeof QueueModule>()),
  enqueueSendMessage: async (_b: string, id: string) => {
    sent.push(id);
  },
}));

const { schema, withTenant } = await import('@fulcra/db');
const { createProduct } = await import('../src/catalog/products');
const { listEvents } = await import('../src/events/events');
const { setPaystackClient } = await import('../src/payments/paystack');
const { savePayoutAccount } = await import('../src/payments/payout');
const { receiveInboundMessage, getConversation } =
  await import('../src/conversations/conversations');
const a = await import('../src/agent/assistant');
const { getAgentSettings, saveAgentSettings } = await import('../src/agent/settings');
const { savePhotoDescription } = await import('../src/agent/photos');
const { FakePaystack } = await import('../src/testing/fake-paystack');
const { addMember, productDraft, shopWithStock } = await import('./helpers');

beforeEach(() => {
  sent.length = 0;
  setPaystackClient(new FakePaystack());
});
afterEach(() => setPaystackClient(null));

/** A shop with the assistant on, payouts set up, a WhatsApp chat and a ₦15,000 dress (stock 5). */
async function assistantShop(enabled = true) {
  const shop = await shopWithStock(5, {
    wholesalePrice: 1_200_000,
    wholesaleMinQty: 6,
    category: 'Dresses',
  });
  await savePayoutAccount(shop.actor, { bankCode: '058', accountNumber: '0123456789' });
  await saveAgentSettings(shop.actor, {
    enabled,
    policies: 'No refunds on sale items.',
    handoffTopics: ['discounts'],
  });
  const connection = await withTenant(shop.business.id, async (tx) => {
    const [row] = await tx
      .insert(schema.channelConnections)
      .values({
        businessId: shop.business.id,
        channel: 'whatsapp',
        externalAccountId: `pn-${randomUUID()}`,
      })
      .returning();
    return row!;
  });
  const say = (text: string, from = '2348031234567') =>
    receiveInboundMessage(shop.business.id, connection.id, {
      externalId: `wamid.${randomUUID()}`,
      from: { externalUserId: from, displayName: 'Chioma' },
      sentAt: new Date().toISOString(),
      type: 'text',
      text,
    }) as Promise<{ conversationId: string; messageId: string; route: string }>;
  return { ...shop, connection, say, b: shop.business.id };
}

describe('assistant settings', () => {
  it('saves and reads settings; only the owner changes them', async () => {
    const { actor } = await shopWithStock();
    expect(await getAgentSettings(actor)).toMatchObject({
      enabled: false,
      afterHoursOrders: true,
      businessHours: null,
    });
    const saved = await saveAgentSettings(actor, {
      enabled: true,
      businessHours: { mon: [['09:00', '18:00']] },
      handoffTopics: ['Discounts', 'discounts', 'Custom orders'],
    });
    expect(saved).toMatchObject({ enabled: true, handoffTopics: ['discounts', 'Custom orders'] });
    await expect(
      saveAgentSettings(actor, { enabled: true, businessHours: { mon: [['18:00', '09:00']] } }),
    ).rejects.toThrow();
    const staff = await addMember(actor, 'staff');
    await expect(saveAgentSettings(staff, { enabled: false })).rejects.toThrow();
    expect((await getAgentSettings(staff)).enabled).toBe(true);
  });
});

describe('claimAgentTurn', () => {
  it('gives the assistant the context, only when it should answer', async () => {
    const s = await assistantShop();
    const first = await s.say('Hi');
    expect(first.route).toBe('agent');
    const second = await s.say('How much is the Ankara dress?');
    // The first message's job steps aside for the newer one.
    expect(await a.claimAgentTurn(s.b, first.conversationId, first.messageId)).toBeNull();
    const turn = await a.claimAgentTurn(s.b, second.conversationId, second.messageId);
    expect(turn).toMatchObject({
      channel: 'whatsapp',
      customer: { name: 'Chioma', phone: '+2348031234567', orderCount: 0 },
      deliveryAreas: [{ name: 'Lekki', fee: 200_000 }],
      categories: ['Dresses'],
      settings: { enabled: true, policies: 'No refunds on sale items.' },
      lastInboundId: second.messageId,
    });
    expect(turn!.history.map((h) => h.text)).toEqual(['Hi', 'How much is the Ankara dress?']);

    await a.queueAgentReply(s.b, second.conversationId, 'Hello Chioma!');
    expect(await a.claimAgentTurn(s.b, second.conversationId)).toBeNull(); // already answered
  });

  it('does not answer when the assistant is off or the team has the chat', async () => {
    const off = await assistantShop(false);
    const m = await off.say('Hello');
    expect(m.route).toBe('human');
    expect(await a.claimAgentTurn(off.b, m.conversationId)).toBeNull();
    const on = await assistantShop();
    const n = await on.say('Hello');
    await a.assistantHandOff(on.b, n.conversationId, 'Customer asked for a person');
    expect(await a.claimAgentTurn(on.b, n.conversationId)).toBeNull();
  });
});

describe('assistant tools', () => {
  it('finds products and quotes prices from the database, with wholesale by quantity', async () => {
    const s = await assistantShop();
    await createProduct(
      s.actor,
      productDraft({
        name: 'Ankara Midi Dress',
        category: 'Dresses',
        retailPrice: 2_000_000,
        options: { kind: 'simple', stock: 0 },
      }),
    );
    const { conversationId } = await s.say('dress?');
    const found = await a.assistantSearchProducts(s.b, conversationId, { query: 'ankara dress' });
    expect(found.products.map((x) => [x.name, x.price, x.inStock])).toEqual(
      expect.arrayContaining([
        ['Ankara dress', '₦15,000.00', true],
        ['Ankara Midi Dress', '₦20,000.00', false],
      ]),
    );
    const product = await a.assistantGetProduct(s.b, conversationId, s.product.id);
    expect(product).toMatchObject({
      wholesale: { price: '₦12,000.00', minQuantity: 6 },
      options: [
        { variantId: s.variant.id, option: 'standard', price: '₦15,000.00', stock: 'In stock' },
      ],
    });
    expect(
      await a.assistantCheckStock(s.b, conversationId, { variantId: s.variant.id, quantity: 2 }),
    ).toMatchObject({
      available: true,
      unitPrice: '₦15,000.00',
      total: '₦30,000.00',
      wholesalePriceApplied: false,
    });
    expect(
      await a.assistantCheckStock(s.b, conversationId, { variantId: s.variant.id, quantity: 6 }),
    ).toMatchObject({
      available: false,
      unitPrice: '₦12,000.00',
      total: '₦72,000.00',
      wholesalePriceApplied: true,
    });
    const soldOut = found.products.find((x) => x.name === 'Ankara Midi Dress')!;
    expect(
      (
        await a.assistantSuggestAlternatives(s.b, conversationId, soldOut.productId)
      ).alternatives.map((x) => x.name),
    ).toEqual(['Ankara dress']);
    expect(
      await a.assistantDeliveryFee(s.b, conversationId, 'I stay in Lekki phase 1'),
    ).toMatchObject({ matched: true, areas: [{ name: 'Lekki', fee: '₦2,000.00' }] });
    expect((await a.assistantDeliveryFee(s.b, conversationId, 'Ikeja')).matched).toBe(false);
  });

  it('takes an order for this customer and sends a payment link or account details', async () => {
    const s = await assistantShop();
    const { conversationId } = await s.say('I want 2');
    const order = await a.assistantCreateOrder(s.b, conversationId, {
      items: [{ variantId: s.variant.id, quantity: 2 }],
      fulfilment: 'delivery',
      deliveryZoneId: s.zone.id,
      deliveryAddress: '12 Admiralty Way',
    });
    expect(order).toMatchObject({
      orderNumber: 1001,
      subtotal: '₦30,000.00',
      delivery: 'Lekki: ₦2,000.00',
      total: '₦32,000.00',
    });
    const link = await a.assistantPaymentLink(s.b, conversationId, 1001);
    expect(link).toMatchObject({
      orderNumber: 1001,
      total: '₦32,000.00',
      paymentLink: expect.stringMatching(/^https:\/\//),
    });
    expect(await a.assistantOrderStatus(s.b, conversationId, 1001)).toMatchObject({
      orders: [{ orderNumber: 1001, status: 'Awaiting payment', paid: false }],
    });
    const events = await listEvents(s.actor);
    expect(events.find((e) => e.type === 'order.created')).toMatchObject({ actorType: 'agent' });

    // Another customer cannot see this order through the assistant.
    const other = await s.say('what about order 1001?', '2348090000000');
    await expect(a.assistantOrderStatus(s.b, other.conversationId, 1001)).rejects.toThrow(
      'has no order #1001',
    );
    await expect(a.assistantPaymentLink(s.b, other.conversationId, 1001)).rejects.toThrow(
      'has no order #1001',
    );
  });

  it('hands off with a reason, and then the tools stop working for the assistant', async () => {
    const s = await assistantShop();
    const { conversationId } = await s.say('Can I talk to a person?');
    await a.assistantHandOff(s.b, conversationId, 'Customer asked for a person');
    const view = await getConversation(s.actor, conversationId);
    expect(view.conversation).toMatchObject({
      handledBy: 'human',
      needsAttention: true,
      attentionReason: 'Customer asked for a person',
    });
    expect((await listEvents(s.actor))[0]).toMatchObject({
      type: 'conversation.handoff',
      actorType: 'agent',
    });
    await expect(
      a.assistantSearchProducts(s.b, conversationId, { query: 'dress' }),
    ).rejects.toThrow('team is handling');
    expect(await a.queueAgentReply(s.b, conversationId, 'Hi')).toMatchObject({ status: 'skipped' });
  });

  it('does not send a reply when a newer customer message arrived, and logs actions', async () => {
    const s = await assistantShop();
    const first = await s.say('Hi');
    await s.say('Are you there?');
    expect(
      await a.queueAgentReply(s.b, first.conversationId, 'Hello!', {
        answeringInboundId: first.messageId,
      }),
    ).toMatchObject({ status: 'skipped', reason: 'a newer customer message arrived' });
    const ok = await a.queueAgentReply(s.b, first.conversationId, 'Hello! Yes, I am here.');
    expect(ok.status).toBe('queued');
    expect(sent).toHaveLength(1);
    await a.recordAgentAction(s.b, first.conversationId, {
      tool: 'searchProducts',
      input: { query: 'dress' },
      output: { products: [] },
      ok: true,
    });
    const actions = await withTenant(s.b, (tx) => tx.select().from(schema.agentActions));
    expect(actions).toEqual([expect.objectContaining({ tool: 'searchProducts', ok: true })]);
    expect(await a.priorReplyTexts(s.b, first.conversationId)).toEqual(['Hello! Yes, I am here.']);
  });
});

describe('photos and search', () => {
  it('search words: lowercase, no filler words, simple plurals', () => {
    expect(a.searchWords('Do you have the BLUE Ankara gowns, abeg?')).toEqual([
      'blue',
      'ankara',
      'gown',
    ]);
    expect(a.searchWords('dress')).toEqual(['dress']);
  });

  it('search: products matching more words, and in the name, come first', async () => {
    const shop = await assistantShop();
    await createProduct(shop.actor, {
      ...productDraft(),
      name: 'Ankara Maxi Gown',
      category: 'Dresses',
      description: 'Blue, puff sleeves',
    });
    const r = (await shop.say('hi')) as { conversationId: string };
    const names = async (query: string) =>
      (await a.assistantSearchProducts(shop.b, r.conversationId, { query })).products.map(
        (x) => x.name,
      );
    expect((await names('blue ankara maxi gown'))[0]).toBe('Ankara Maxi Gown');
    const dressName = (await names('dress'))[0]!;
    expect(dressName).not.toBe('Ankara Maxi Gown'); // "Dresses" in the category counts less
    expect(await names('shoes')).toEqual([]);
  });

  it('what a photo shows is saved on the message and given to the next turn', async () => {
    const shop = await assistantShop();
    const r = (await shop.say('see this')) as { conversationId: string; messageId: string };
    const saved = await savePhotoDescription(shop.business.id, r.messageId, {
      kind: 'product',
      description: '  A red dress.  ',
      textInPhoto: '',
      searchTerms: ['Red', 'red', 'Dress', ''],
    });
    expect(saved).toEqual({
      kind: 'product',
      description: 'A red dress.',
      textInPhoto: '',
      searchTerms: ['red', 'dress'],
    });
    const turn = await a.claimAgentTurn(shop.business.id, r.conversationId, r.messageId);
    expect(turn!.history.at(-1)).toMatchObject({ id: r.messageId, photo: saved, image: null });
  });
});
