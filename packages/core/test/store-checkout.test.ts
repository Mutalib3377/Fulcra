import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { schema, withTenant } from '@fulcra/db';
import { eq } from 'drizzle-orm';
import { createProduct, setProductActive } from '../src/catalog/products';
import { listEvents } from '../src/events/events';
import { getOrder } from '../src/orders/orders';
import { setPaystackClient } from '../src/payments/paystack';
import { savePayoutAccount } from '../src/payments/payout';
import { processPaystackWebhook, recordPaystackWebhook } from '../src/payments/payments';
import { addToCart, parseCart, serializeCart, setCartQuantity } from '../src/storefront/cart-rules';
import {
  businessesWithStaleStoreCheckouts,
  expireStoreCheckouts,
  getStoreCart,
  getStoreCheckoutSetting,
  setStoreCheckoutEnabled,
  startStoreCheckout,
} from '../src/storefront/checkout';
import { getStoreBySubdomain } from '../src/storefront/store';
import { FakePaystack, signedWebhook, TEST_SECRET } from '../src/testing/fake-paystack';
import { addMember, productDraft, shopWithStock } from './helpers';

let paystack: FakePaystack;
const originalKey = process.env.PAYSTACK_SECRET_KEY;
beforeEach(() => {
  paystack = new FakePaystack();
  setPaystackClient(paystack);
  process.env.PAYSTACK_SECRET_KEY = TEST_SECRET;
});
afterEach(() => {
  setPaystackClient(null);
  if (originalKey === undefined) delete process.env.PAYSTACK_SECRET_KEY;
  else process.env.PAYSTACK_SECRET_KEY = originalKey;
});

const later = (minutes: number) => new Date(Date.now() + minutes * 60_000);

/** A shop taking store payments: payouts set, a ₦15,000 dress (stock 5), Lekki delivery ₦2,000. */
async function shop(payout = true, startStock = 5) {
  const s = await shopWithStock(startStock);
  if (payout) await savePayoutAccount(s.actor, { bankCode: '058', accountNumber: '0123456789' });
  const client = { key: randomUUID() };
  const checkout = (overrides: Record<string, unknown> = {}) =>
    startStoreCheckout(
      s.business.id,
      {
        items: [{ variantId: s.variant.id, quantity: 2 }],
        name: 'Amaka Eze',
        phone: '0803 555 0199',
        fulfilment: 'delivery',
        deliveryZoneId: s.zone.id,
        deliveryAddress: '4 Admiralty Way, Lekki',
        ...overrides,
      },
      client,
    );
  const stock = async () => {
    const [v] = await withTenant(s.business.id, (tx) =>
      tx
        .select({ stock: schema.productVariants.stock })
        .from(schema.productVariants)
        .where(eq(schema.productVariants.id, s.variant.id)),
    );
    return v!.stock;
  };
  const storeOrders = () =>
    withTenant(s.business.id, (tx) =>
      tx.select().from(schema.orders).where(eq(schema.orders.channel, 'store')),
    );
  return { ...s, client, checkout, stock, storeOrders };
}

let nextTransactionId = Date.now();
async function pay(reference: string) {
  const { body, signature } = signedWebhook('charge.success', {
    id: nextTransactionId++,
    reference,
    amount: 1,
  });
  const saved = await recordPaystackWebhook(body, signature);
  if (saved.status !== 'saved') throw new Error('webhook not saved');
  return processPaystackWebhook(saved.webhookEventId);
}

describe('cart cookie rules', () => {
  it('reads, adds, caps and drops junk', () => {
    const a = randomUUID();
    const b = randomUUID();
    expect(parseCart(`${a}:2,junk,${b}:0,${a}:1,${b}:x`)).toEqual([{ variantId: a, quantity: 3 }]);
    let cart = addToCart([], a, 15);
    cart = addToCart(cart, a, 15);
    expect(cart).toEqual([{ variantId: a, quantity: 20 }]);
    cart = addToCart(cart, b, 1);
    expect(parseCart(serializeCart(cart))).toEqual(cart);
    expect(setCartQuantity(cart, a, 0)).toEqual([{ variantId: b, quantity: 1 }]);
    expect(parseCart(undefined)).toEqual([]);
  });
});

describe('store checkout', () => {
  it('prices the cart from the database and says what can be bought', async () => {
    const s = await shop();
    const hidden = await createProduct(
      s.actor,
      productDraft({ name: 'Secret', options: { kind: 'simple', stock: 3 } }),
    );
    await setProductActive(s.actor, hidden.product.id, false);
    const cart = await getStoreCart(s.business.id, [
      { variantId: s.variant.id, quantity: 6 },
      { variantId: hidden.variants[0]!.id, quantity: 1 },
      { variantId: randomUUID(), quantity: 1 },
    ]);
    expect(cart.checkoutOpen).toBe(true);
    expect(cart.lines.map((l) => [l.productName, l.unitPrice, l.problem, l.available])).toEqual([
      ['Ankara dress', 1_500_000, 'not_enough', 5],
      ['Secret', 1_500_000, 'unavailable', 3],
    ]);
    expect(cart.subtotal).toBe(9_000_000);
    expect(cart.deliveryZones).toMatchObject([{ name: 'Lekki', fee: 200_000 }]);
  });

  it('creates a store order, holds stock, opens Paystack; the webhook marks it paid', async () => {
    const s = await shop();
    const result = await s.checkout({ email: 'amaka@example.com' });
    expect(result).toMatchObject({
      orderNumber: 1001,
      paymentUrl: expect.stringMatching(/^https:\/\/checkout\.paystack\.com\//),
      receiptToken: expect.any(String),
    });
    expect(await s.stock()).toBe(3);
    const [order] = await s.storeOrders();
    expect(order).toMatchObject({
      status: 'awaiting_payment',
      subtotal: 3_000_000,
      deliveryFee: 200_000,
      total: 3_200_000,
      deliveryZoneName: 'Lekki',
    });
    // Paystack got the real total, the seller's subaccount and the store's receipt page.
    expect(paystack.initialized.at(-1)).toMatchObject({
      amount: 3_200_000,
      email: 'amaka@example.com',
      callbackUrl: expect.stringContaining(result.receiptToken),
    });
    const events = await listEvents(s.actor);
    expect(events.find((e) => e.type === 'order.created')).toMatchObject({
      actorType: 'customer',
      payload: { channel: 'store' },
    });

    const reference = paystack.initialized.at(-1)!.reference;
    await pay(reference);
    const paid = await getOrder(s.actor, order!.id);
    expect(paid.order).toMatchObject({ status: 'paid', amountPaid: 3_200_000 });
    expect(paid.customer).toMatchObject({ name: 'Amaka Eze', phone: '+2348035550199' });
    // Paid orders are never cancelled by the timer.
    expect(await expireStoreCheckouts(s.business.id, later(45))).toBe(0);
  });

  it('unpaid store orders are cancelled after 30 minutes and their stock comes back', async () => {
    const s = await shop();
    await s.checkout({ fulfilment: 'pickup', deliveryZoneId: null, deliveryAddress: '' });
    expect(await s.stock()).toBe(3);
    expect(await expireStoreCheckouts(s.business.id, later(20))).toBe(0);
    expect(await businessesWithStaleStoreCheckouts(later(31))).toContain(s.business.id);
    expect(await expireStoreCheckouts(s.business.id, later(31))).toBe(1);
    expect(await s.stock()).toBe(5);
    const [order] = await s.storeOrders();
    expect(order).toMatchObject({ status: 'cancelled' });
    expect(order!.cancelReason).toMatch(/Not paid within 30 minutes/);
    // Money that still arrives is flagged for the owner, never lost or counted silently.
    await pay(paystack.initialized.at(-1)!.reference);
    const [payment] = await withTenant(s.business.id, (tx) =>
      tx.select().from(schema.payments).where(eq(schema.payments.orderId, order!.id)),
    );
    expect(payment!.status).toBe('needs_review');
  });

  it('a new checkout from the same phone replaces the unpaid one (stock not held twice)', async () => {
    const s = await shop();
    await s.checkout();
    await s.checkout({ items: [{ variantId: s.variant.id, quantity: 1 }] });
    const orders = await s.storeOrders();
    expect(orders.map((o) => o.status).sort()).toEqual(['awaiting_payment', 'cancelled']);
    expect(await s.stock()).toBe(4);
  });

  it('checks the input, the stock and the delivery area on the server', async () => {
    const s = await shop();
    await expect(s.checkout({ phone: '12' })).rejects.toMatchObject({ field: 'phone' });
    await expect(s.checkout({ deliveryAddress: '' })).rejects.toMatchObject({
      field: 'deliveryAddress',
    });
    await expect(s.checkout({ email: 'not-an-email' })).rejects.toMatchObject({ field: 'email' });
    await expect(s.checkout({ items: [] })).rejects.toThrow('Your cart is empty.');
    await expect(s.checkout({ items: [{ variantId: s.variant.id, quantity: 6 }] })).rejects.toThrow(
      /Only 5 left|not enough|left/i,
    );
    const other = await shopWithStock(5);
    await expect(s.checkout({ deliveryZoneId: other.zone.id })).rejects.toThrow(
      'Choose a delivery area from your list.',
    );
    expect(await s.stock()).toBe(5);
    expect(await s.storeOrders()).toEqual([]);
  });

  it('if Paystack fails, the order is cancelled and stock returned', async () => {
    const s = await shop();
    paystack.failInitialize = true;
    await expect(s.checkout()).rejects.toThrow(/Paystack could not create the payment link/);
    expect(await s.stock()).toBe(5);
    expect((await s.storeOrders()).map((o) => o.status)).toEqual(['cancelled']);
  });

  it('limits checkouts per device', async () => {
    const s = await shop(true, 50);
    for (let i = 0; i < 8; i++)
      await s.checkout({
        phone: `0803555${String(1000 + i)}`,
        items: [{ variantId: s.variant.id, quantity: 1 }],
        fulfilment: 'pickup',
        deliveryZoneId: null,
      });
    await expect(s.checkout({ phone: '08035559999' })).rejects.toThrow(/Too many checkouts/);
  });

  it('only when the seller has a payout account and the switch is on', async () => {
    const noPayout = await shop(false);
    expect((await getStoreCart(noPayout.business.id, [])).checkoutOpen).toBe(false);
    await expect(noPayout.checkout()).rejects.toThrow(/takes orders on WhatsApp/);
    expect((await getStoreBySubdomain(noPayout.business.subdomain))!.checkout).toBe(false);

    const s = await shop();
    expect((await getStoreBySubdomain(s.business.subdomain))!.checkout).toBe(true);
    expect(await getStoreCheckoutSetting(s.actor)).toEqual({ enabled: true, hasPayout: true });
    const staff = await addMember(s.actor, 'staff');
    await expect(setStoreCheckoutEnabled(staff, false)).rejects.toThrow();
    expect(await setStoreCheckoutEnabled(s.actor, false)).toEqual({
      enabled: false,
      hasPayout: true,
    });
    expect((await getStoreBySubdomain(s.business.subdomain))!.checkout).toBe(false);
    await expect(s.checkout()).rejects.toThrow(/takes orders on WhatsApp/);
    expect(await s.stock()).toBe(5);
  });
});
