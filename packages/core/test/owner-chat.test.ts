import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type * as QueueModule from '../src/jobs/queue';

const queued: { businessId: string; chatId: string; messageId: string }[] = [];
vi.mock('../src/jobs/queue', async (original) => ({
  ...(await original<typeof QueueModule>()),
  enqueueOwnerMessage: async (businessId: string, chatId: string, messageId: string) => {
    queued.push({ businessId, chatId, messageId });
  },
}));

const { schema, withTenant } = await import('@fulcra/db');
const { eq, sql } = await import('drizzle-orm');
const chats = await import('../src/owner-chat/chats');
const insights = await import('../src/owner-chat/insights');
const { createOrder, markOrderPaid, getOrder } = await import('../src/orders/orders');
const { getProduct } = await import('../src/catalog/products');
const { addMember, newBusiness, shopWithStock } = await import('./helpers');

type Actor = { businessId: string; userId: string };
const lastQueued = (businessId: string) => queued.filter((q) => q.businessId === businessId).at(-1);

/** Owner writes, the "assistant" proposes a change (as the agent would), returns the turn. */
async function propose(
  actor: Actor,
  text: string,
  kind: Parameters<typeof chats.proposeOwnerAction>[1],
  input: unknown,
) {
  await chats.sendOwnerDashboardMessage(actor, { text });
  const job = lastQueued(actor.businessId)!;
  const turn = await chats.claimOwnerTurn(job.businessId, job.chatId, job.messageId);
  expect(turn).not.toBeNull();
  const { summary } = await chats.proposeOwnerAction(turn!, kind, input);
  await chats.saveOwnerReply(turn!, `${summary}? Reply YES to confirm.`);
  return { turn: turn!, summary };
}
const lastReply = async (actor: Actor) =>
  (await chats.getOwnerDashboardChat(actor)).messages.filter((m) => m.sender === 'assistant').at(-1)
    ?.text;

describe("owner's questions", () => {
  it('sales today and yesterday, best sellers, unpaid orders, one order, products', async () => {
    const shop = await shopWithStock(20);
    const order = async () =>
      (
        await createOrder(shop.actor, {
          customer: { name: 'Chioma Obi', phone: '0805 111 2222' },
          items: [{ variantId: shop.variant.id, quantity: 2 }],
          fulfilment: 'pickup',
        })
      ).order;
    const paid = await order();
    await markOrderPaid(shop.actor, paid.id, { method: 'cash' });
    const older = await order();
    await markOrderPaid(shop.actor, older.id, { method: 'cash' });
    await withTenant(shop.business.id, (tx) =>
      tx
        .update(schema.orders)
        .set({ paidAt: sql`now() - interval '1 day'` })
        .where(eq(schema.orders.id, older.id)),
    );
    const unpaid = await order();

    const today = await insights.ownerSalesSummary(shop.actor, 'today');
    expect(today).toMatchObject({
      paidOrders: 1,
      amount: paid.total,
      unpaidOrders: 1,
      unpaidAmount: unpaid.total,
    });
    expect((await insights.ownerSalesSummary(shop.actor, 'yesterday')).paidOrders).toBe(1);
    expect((await insights.ownerSalesSummary(shop.actor, 'last_7_days')).paidOrders).toBe(2);

    const best = await insights.ownerBestSellers(shop.actor, 'last_7_days');
    expect(best.products[0]).toMatchObject({ name: 'Ankara dress', quantity: 4 });

    const list = await insights.ownerOrders(shop.actor, 'unpaid');
    expect(list.total).toBe(1);
    expect(list.orders[0]).toMatchObject({
      orderNumber: unpaid.orderNumber,
      customer: 'Chioma Obi',
    });

    const one = await insights.ownerFindOrder(shop.actor, paid.orderNumber);
    expect(one).toMatchObject({
      orderNumber: paid.orderNumber,
      status: 'paid',
      items: [{ name: 'Ankara dress', quantity: 2 }],
    });
    await expect(insights.ownerFindOrder(shop.actor, 999999)).rejects.toThrow(
      'There is no order #999999',
    );

    const { archiveProduct, createProduct } = await import('../src/catalog/products');
    const old = await createProduct(shop.actor, {
      name: 'Ankara old style',
      retailPrice: 100_000,
      options: { kind: 'simple', stock: 1 },
    });
    await archiveProduct(shop.actor, old.product.id);
    const found = await insights.ownerFindProducts(shop.actor, 'ankara');
    expect(found.map((f) => f.name)).not.toContain('Ankara old style'); // deleted products never show
    expect(found[0]).toMatchObject({
      name: 'Ankara dress',
      options: [{ variantId: shop.variant.id, stock: 14 }],
    });
  });

  it('is for the owner only, and each business sees only its own chat', async () => {
    const shop = await newBusiness('owner-only');
    const staff = await addMember(shop.actor, 'staff');
    await expect(insights.ownerSalesSummary(staff, 'today')).rejects.toThrow();
    await expect(chats.sendOwnerDashboardMessage(staff, { text: 'hi' })).rejects.toThrow();

    await chats.sendOwnerDashboardMessage(shop.actor, { text: 'How much did I sell today?' });
    const other = await newBusiness('owner-other');
    expect((await chats.getOwnerDashboardChat(other.actor)).messages).toHaveLength(0);
    expect((await chats.getOwnerDashboardChat(shop.actor)).messages).toHaveLength(1);
  });
});

describe('changes need a YES', () => {
  it('adds a product with the photo only after YES, and a second YES does nothing', async () => {
    const shop = await newBusiness('owner-add');
    const photo = { path: `${shop.business.id}/${randomUUID()}`, width: 800, height: 800 };
    await chats.sendOwnerDashboardMessage(shop.actor, { text: '', image: photo });
    const { summary } = await propose(
      shop.actor,
      'New product: Adire top, 12k, 4 pieces, use the photo',
      'add_product',
      {
        name: 'Adire top',
        priceNaira: 12000,
        stock: 4,
        usePhoto: true,
      },
    );
    expect(summary).toBe('Add "Adire top" at ₦12,000.00 with 4 in stock');
    // The photo was in an earlier message, not the newest: the proposal says so honestly.
    const view = await chats.getOwnerDashboardChat(shop.actor);
    expect(view.pending?.summary).toBe(summary);

    const before = await withTenant(shop.business.id, (tx) => tx.select().from(schema.products));
    expect(before).toHaveLength(0);
    await chats.sendOwnerDashboardMessage(shop.actor, { text: 'Yes' });
    const products = await withTenant(shop.business.id, (tx) => tx.select().from(schema.products));
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({ name: 'Adire top', retailPrice: 1_200_000 });
    expect(await lastReply(shop.actor)).toMatch(/^Done\. "Adire top" is in your catalog/);
    expect((await chats.getOwnerDashboardChat(shop.actor)).pending).toBeNull();

    const jobs = queued.length;
    await chats.sendOwnerDashboardMessage(shop.actor, { text: 'yes' });
    expect(
      await withTenant(shop.business.id, (tx) => tx.select().from(schema.products)),
    ).toHaveLength(1);
    expect(queued.length).toBe(jobs + 1); // no change waiting: an ordinary message for the assistant
  });

  it('uses the photo sent with the request', async () => {
    const shop = await newBusiness('owner-photo');
    const photo = { path: `${shop.business.id}/${randomUUID()}`, width: 800, height: 800 };
    await chats.sendOwnerDashboardMessage(shop.actor, {
      text: 'Add this: Kaftan, 20k, 3 pieces',
      image: photo,
    });
    const job = lastQueued(shop.business.id)!;
    const turn = (await chats.claimOwnerTurn(job.businessId, job.chatId, job.messageId))!;
    expect(turn.hasPhoto).toBe(true);
    const { summary } = await chats.proposeOwnerAction(turn, 'add_product', {
      name: 'Kaftan',
      priceNaira: 20000,
      stock: 3,
      usePhoto: true,
    });
    expect(summary).toContain('using the photo you sent');
    await chats.sendOwnerDashboardMessage(shop.actor, { text: 'oya do am' });
    const [p] = await withTenant(shop.business.id, (tx) => tx.select().from(schema.products));
    expect(p!.photos).toEqual([photo]);
  });

  it('stock, price, hide, paid, dispatched and cancel go through the usual rules', async () => {
    const shop = await shopWithStock(5);
    const { order } = await createOrder(shop.actor, {
      customer: { name: 'Bola', phone: '0805 333 4444' },
      items: [{ variantId: shop.variant.id, quantity: 1 }],
      fulfilment: 'delivery',
      deliveryZoneId: shop.zone.id,
      deliveryAddress: '12 Admiralty Way, Lekki',
    });
    const yes = () => chats.sendOwnerDashboardMessage(shop.actor, { text: 'YES' });

    await propose(shop.actor, 'set ankara to 10', 'set_stock', {
      variantId: shop.variant.id,
      stock: 10,
    });
    await yes();
    expect((await getProduct(shop.actor, shop.product.id)).variants[0]!.stock).toBe(10);

    await propose(shop.actor, 'price 18k', 'set_price', {
      productId: shop.product.id,
      priceNaira: 18000,
    });
    await yes();
    expect((await getProduct(shop.actor, shop.product.id)).product.retailPrice).toBe(1_800_000);

    await propose(shop.actor, 'hide it', 'set_visibility', {
      productId: shop.product.id,
      visible: false,
    });
    await yes();
    expect((await getProduct(shop.actor, shop.product.id)).product.isActive).toBe(false);

    const { summary } = await propose(shop.actor, `${order.orderNumber} paid cash`, 'mark_paid', {
      orderNumber: order.orderNumber,
      method: 'cash',
    });
    expect(summary).toContain(`order #${order.orderNumber} (Bola`);
    await yes();
    expect((await getOrder(shop.actor, order.id)).order.status).toBe('paid');
    await expect(
      propose(shop.actor, 'mark paid again', 'mark_paid', {
        orderNumber: order.orderNumber,
        method: 'cash',
      }),
    ).rejects.toThrow('already paid');

    // A pickup order can't be dispatched: refused before asking for a YES.
    const { order: pickup } = await createOrder(shop.actor, {
      customer: { name: 'Bola', phone: '0805 333 4444' },
      items: [{ variantId: shop.variant.id, quantity: 1 }],
      fulfilment: 'pickup',
    });
    await markOrderPaid(shop.actor, pickup.id, { method: 'cash' });
    await expect(
      propose(shop.actor, 'pickup sent', 'set_order_status', {
        orderNumber: pickup.orderNumber,
        status: 'dispatched',
      }),
    ).rejects.toThrow('is a pickup order');

    await propose(shop.actor, `${order.orderNumber} don go`, 'set_order_status', {
      orderNumber: order.orderNumber,
      status: 'dispatched',
    });
    await yes();
    expect((await getOrder(shop.actor, order.id)).order.status).toBe('dispatched');

    const { order: other } = await createOrder(shop.actor, {
      customer: { name: 'Bola', phone: '0805 333 4444' },
      items: [{ variantId: shop.variant.id, quantity: 2 }],
      fulfilment: 'pickup',
    });
    await propose(shop.actor, 'cancel it', 'cancel_order', {
      orderNumber: other.orderNumber,
      reason: 'Customer changed mind',
    });
    await yes();
    expect((await getOrder(shop.actor, other.id)).order.status).toBe('cancelled');
    expect(await lastReply(shop.actor)).toContain('stock is back');
  });

  it('NO drops it; an expired change is not run; a failed change says why', async () => {
    const shop = await shopWithStock(5);
    await propose(shop.actor, 'set to 0', 'set_stock', { variantId: shop.variant.id, stock: 0 });
    await chats.sendOwnerDashboardMessage(shop.actor, { text: 'No' });
    expect(await lastReply(shop.actor)).toBe("Okay, I won't do that.");
    expect((await getProduct(shop.actor, shop.product.id)).variants[0]!.stock).toBe(5);

    await propose(shop.actor, 'set to 1', 'set_stock', { variantId: shop.variant.id, stock: 1 });
    const later = new Date(Date.now() + 11 * 60_000);
    const jobs = queued.length;
    await chats.sendOwnerDashboardMessage(shop.actor, { text: 'yes' }, later);
    expect((await getProduct(shop.actor, shop.product.id)).variants[0]!.stock).toBe(5);
    expect(queued.length).toBe(jobs + 1); // treated as a new message for the assistant

    // Price below the wholesale price is refused by the usual rules, with the reason.
    await withTenant(shop.business.id, (tx) =>
      tx
        .update(schema.products)
        .set({ wholesalePrice: 1_000_000, wholesaleMinQty: 5 })
        .where(eq(schema.products.id, shop.product.id)),
    );
    await propose(shop.actor, 'price 5k', 'set_price', {
      productId: shop.product.id,
      priceNaira: 5000,
    });
    await chats.sendOwnerDashboardMessage(shop.actor, { text: 'yes' });
    expect(await lastReply(shop.actor)).toMatch(
      /^I couldn't do that: The wholesale price is higher/,
    );
  });
});

describe('limits', () => {
  it('a trial has 50 owner messages a month; after that a plain reply, no AI', async () => {
    const shop = await newBusiness('owner-limit');
    await chats.sendOwnerDashboardMessage(shop.actor, { text: 'hello' });
    const chatId = lastQueued(shop.business.id)!.chatId;
    await withTenant(shop.business.id, (tx) =>
      tx.insert(schema.ownerChatMessages).values(
        Array.from({ length: 49 }, () => ({
          businessId: shop.business.id,
          chatId,
          sender: 'owner' as const,
          text: 'x',
          status: 'received' as const,
        })),
      ),
    );
    expect((await chats.getOwnerDashboardChat(shop.actor)).limit).toEqual({ used: 50, limit: 50 });
    const jobs = queued.length;
    await chats.sendOwnerDashboardMessage(shop.actor, { text: 'one more' });
    expect(queued.length).toBe(jobs);
    expect(await lastReply(shop.actor)).toContain("You've used your 50 assistant messages");
  });

  it('only the newest message gets an answer', async () => {
    const shop = await newBusiness('owner-newest');
    await chats.sendOwnerDashboardMessage(shop.actor, { text: 'first' });
    const first = lastQueued(shop.business.id)!;
    await chats.sendOwnerDashboardMessage(shop.actor, { text: 'second' });
    expect(await chats.claimOwnerTurn(first.businessId, first.chatId, first.messageId)).toBeNull();
    const second = lastQueued(shop.business.id)!;
    const turn = await chats.claimOwnerTurn(second.businessId, second.chatId, second.messageId);
    expect(turn?.history.map((h) => h.text)).toEqual(['first', 'second']);
  });
});
