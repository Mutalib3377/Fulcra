import { describe, expect, it } from 'vitest';
import { createProduct, getProduct, setProductActive } from '../src/catalog/products';
import { listStockMovements } from '../src/catalog/stock';
import { getCustomer } from '../src/customers/customers';
import { listEvents } from '../src/events/events';
import {
  cancelOrder,
  countOrdersByStatus,
  createOrder,
  createOrderInTx,
  listOrders,
  markOrderPaid,
  updateOrderStatus,
} from '../src/orders/orders';
import { withTenant } from '@fulcra/db';
import { addMember, productDraft, shopWithStock } from './helpers';

const stockOf = async (actor: { businessId: string; userId: string }, productId: string) =>
  (await getProduct(actor, productId)).variants[0]!.stock;

describe('createOrder', () => {
  it('records a delivery order: numbers, totals, stock reserved, customer remembered, events', async () => {
    const { actor, zone, product, variant } = await shopWithStock(5);
    const { order, items, customer } = await createOrder(actor, {
      customer: { name: 'Chioma', phone: '0803 123 4567' },
      items: [{ variantId: variant.id, quantity: 2 }],
      fulfilment: 'delivery',
      deliveryZoneId: zone.id,
      deliveryAddress: '12 Admiralty Way, Lekki',
      discount: 50_000,
    });

    expect(order).toMatchObject({
      orderNumber: 1001,
      status: 'new',
      subtotal: 3_000_000,
      deliveryFee: 200_000,
      discount: 50_000,
      total: 3_150_000,
      deliveryZoneName: 'Lekki',
      channel: 'manual',
    });
    expect(items).toEqual([
      expect.objectContaining({
        productName: 'Ankara dress',
        variantLabel: '',
        quantity: 2,
        unitPrice: 1_500_000,
        lineTotal: 3_000_000,
      }),
    ]);
    expect(customer).toMatchObject({ name: 'Chioma', phone: '+2348031234567' });

    expect(await stockOf(actor, product.id)).toBe(3);
    const [movement] = await listStockMovements(actor, variant.id);
    expect(movement).toMatchObject({ change: -2, reason: 'sale', note: 'Order #1001' });

    const remembered = await getCustomer(actor, customer.id);
    expect(remembered.customer).toMatchObject({
      address: '12 Admiralty Way, Lekki',
      deliveryZoneId: zone.id,
    });

    const types = (await listEvents(actor)).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['order.created', 'customer.created']));

    // Same phone in another format → same customer, next number.
    const second = await createOrder(actor, {
      customer: { phone: '+2348031234567' },
      items: [{ variantId: variant.id, quantity: 1 }],
      fulfilment: 'pickup',
    });
    expect(second.order.orderNumber).toBe(1002);
    expect(second.customer.id).toBe(customer.id);
    expect(second.order).toMatchObject({ deliveryFee: 0, total: 1_500_000, deliveryAddress: '' });
  });

  it('applies wholesale price by quantity and merges repeated lines', async () => {
    const { actor, variant } = await shopWithStock(20, {
      wholesalePrice: 1_200_000,
      wholesaleMinQty: 6,
    });
    const { items, order } = await createOrder(actor, {
      customer: { name: 'Bulk buyer' },
      items: [
        { variantId: variant.id, quantity: 4 },
        { variantId: variant.id, quantity: 2 },
      ],
      fulfilment: 'pickup',
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ quantity: 6, unitPrice: 1_200_000, isWholesale: true });
    expect(order.total).toBe(7_200_000);
  });

  it('refuses orders it cannot fulfil, changing nothing', async () => {
    const { actor, zone, product, variant } = await shopWithStock(2);
    await expect(
      createOrder(actor, {
        customer: { name: 'A' },
        items: [{ variantId: variant.id, quantity: 3 }],
        fulfilment: 'pickup',
      }),
    ).rejects.toMatchObject({ code: 'conflict', message: expect.stringContaining('Only 2 left') });
    await expect(
      createOrder(actor, {
        customer: { name: 'A' },
        items: [{ variantId: variant.id, quantity: 1 }],
        fulfilment: 'delivery',
        deliveryZoneId: zone.id,
      }),
    ).rejects.toMatchObject({ field: 'deliveryAddress' });
    await expect(
      createOrder(actor, {
        customer: { name: 'A' },
        items: [{ variantId: variant.id, quantity: 1 }],
        fulfilment: 'pickup',
        discount: 1_600_000,
      }),
    ).rejects.toMatchObject({ field: 'discount' });
    await expect(
      createOrder(actor, {
        customer: { name: 'A' },
        items: [{ variantId: variant.id, quantity: 1 }],
        fulfilment: 'delivery',
      }),
    ).rejects.toThrow();

    expect(await stockOf(actor, product.id)).toBe(2);
    expect(await listOrders(actor)).toEqual([]);
    // Failed attempts don't use up order numbers.
    const ok = await createOrder(actor, {
      customer: { name: 'A' },
      items: [{ variantId: variant.id, quantity: 1 }],
      fulfilment: 'pickup',
    });
    expect(ok.order.orderNumber).toBe(1001);
  });

  it('two orders for the last item: only one succeeds', async () => {
    const { actor, product, variant } = await shopWithStock(1);
    const attempt = () =>
      createOrder(actor, {
        customer: { name: 'Racer' },
        items: [{ variantId: variant.id, quantity: 1 }],
        fulfilment: 'pickup',
      });
    const results = await Promise.allSettled([attempt(), attempt()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await stockOf(actor, product.id)).toBe(0);
  });

  it('owners can order hidden products; other callers (the assistant later) cannot', async () => {
    const { actor, product, variant } = await shopWithStock(5);
    await setProductActive(actor, product.id, false);
    await expect(
      createOrder(actor, {
        customer: { name: 'A' },
        items: [{ variantId: variant.id, quantity: 1 }],
        fulfilment: 'pickup',
      }),
    ).resolves.toBeTruthy();
    await expect(
      withTenant(actor.businessId, (tx) =>
        createOrderInTx(
          tx,
          actor.businessId,
          {
            customer: { name: 'B' },
            items: [{ variantId: variant.id, quantity: 1 }],
            fulfilment: 'pickup',
            channel: 'whatsapp',
          },
          { type: 'agent' },
        ),
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('raises stock.low once when an order crosses the warning level', async () => {
    const { actor, variant } = await shopWithStock(5);
    await createOrder(actor, {
      customer: { name: 'A' },
      items: [{ variantId: variant.id, quantity: 1 }],
      fulfilment: 'pickup',
    });
    expect((await listEvents(actor)).filter((e) => e.type === 'stock.low')).toHaveLength(0);
    await createOrder(actor, {
      customer: { name: 'A' },
      items: [{ variantId: variant.id, quantity: 1 }],
      fulfilment: 'pickup',
    });
    await createOrder(actor, {
      customer: { name: 'A' },
      items: [{ variantId: variant.id, quantity: 1 }],
      fulfilment: 'pickup',
    });
    const low = (await listEvents(actor)).filter((e) => e.type === 'stock.low');
    expect(low).toHaveLength(1);
    expect(low[0]!.payload).toMatchObject({ productName: 'Ankara dress', stock: 3, threshold: 3 });
  });
});

describe('order lifecycle', () => {
  it('goes new → awaiting payment → paid → dispatched → delivered, with a timeline', async () => {
    const { actor, zone, variant } = await shopWithStock(5);
    const { order } = await createOrder(actor, {
      customer: { name: 'Tunde', phone: '08099998888' },
      items: [{ variantId: variant.id, quantity: 1 }],
      fulfilment: 'delivery',
      deliveryZoneId: zone.id,
      deliveryAddress: '4 Allen Avenue, Ikeja',
    });

    await updateOrderStatus(actor, order.id, 'awaiting_payment');
    const paid = await markOrderPaid(actor, order.id, {
      method: 'transfer',
      note: 'GTBank alert seen',
    });
    expect(paid.order).toMatchObject({
      status: 'paid',
      amountPaid: order.total,
      paymentMethod: 'transfer',
    });
    expect(paid.order.paidAt).toBeInstanceOf(Date);
    await updateOrderStatus(actor, order.id, 'dispatched');
    const done = await updateOrderStatus(actor, order.id, 'delivered');
    expect(done.order.status).toBe('delivered');
    expect(done.order.deliveredAt).toBeInstanceOf(Date);

    const timeline = (await listEvents(actor, { orderId: order.id })).map((e) => e.type).reverse();
    expect(timeline).toEqual([
      'order.created',
      'order.status_changed',
      'order.paid',
      'order.status_changed',
      'order.status_changed',
    ]);

    await expect(updateOrderStatus(actor, order.id, 'dispatched')).rejects.toMatchObject({
      code: 'conflict',
    });
    await expect(cancelOrder(actor, order.id)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('pickup orders skip dispatch', async () => {
    const { actor, variant } = await shopWithStock(5);
    const { order } = await createOrder(actor, {
      customer: { name: 'A' },
      items: [{ variantId: variant.id, quantity: 1 }],
      fulfilment: 'pickup',
    });
    await markOrderPaid(actor, order.id, { method: 'cash' });
    await expect(updateOrderStatus(actor, order.id, 'dispatched')).rejects.toMatchObject({
      code: 'conflict',
    });
    expect((await updateOrderStatus(actor, order.id, 'delivered')).order.status).toBe('delivered');
  });

  it('cancelling returns stock once', async () => {
    const { actor, product, variant } = await shopWithStock(5);
    const { order } = await createOrder(actor, {
      customer: { name: 'A' },
      items: [{ variantId: variant.id, quantity: 2 }],
      fulfilment: 'pickup',
    });
    expect(await stockOf(actor, product.id)).toBe(3);
    const cancelled = await cancelOrder(actor, order.id, { reason: 'Customer changed mind' });
    expect(cancelled.order).toMatchObject({
      status: 'cancelled',
      cancelReason: 'Customer changed mind',
    });
    expect(await stockOf(actor, product.id)).toBe(5);
    const [movement] = await listStockMovements(actor, variant.id);
    expect(movement).toMatchObject({ change: 2, reason: 'cancellation' });
    await expect(cancelOrder(actor, order.id)).rejects.toMatchObject({ code: 'conflict' });
    expect(await stockOf(actor, product.id)).toBe(5);
  });

  it('riders can update delivery but not create, cancel or record payment', async () => {
    const { actor, zone, variant } = await shopWithStock(5);
    const rider = await addMember(actor, 'rider');
    const { order } = await createOrder(actor, {
      customer: { name: 'A' },
      items: [{ variantId: variant.id, quantity: 1 }],
      fulfilment: 'delivery',
      deliveryZoneId: zone.id,
      deliveryAddress: '1 Rider Street',
    });
    await expect(
      createOrder(rider, {
        customer: { name: 'B' },
        items: [{ variantId: variant.id, quantity: 1 }],
        fulfilment: 'pickup',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(markOrderPaid(rider, order.id, { method: 'cash' })).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(cancelOrder(rider, order.id)).rejects.toMatchObject({ code: 'forbidden' });
    await markOrderPaid(actor, order.id, { method: 'cash' });
    await updateOrderStatus(rider, order.id, 'dispatched');
    expect((await updateOrderStatus(rider, order.id, 'delivered')).order.status).toBe('delivered');
  });
});

describe('listing orders', () => {
  it('filters by status and searches number, name and phone', async () => {
    const { actor, variant } = await shopWithStock(20);
    const make = (name: string, phone?: string) =>
      createOrder(actor, {
        customer: { name, ...(phone ? { phone } : {}) },
        items: [{ variantId: variant.id, quantity: 1 }],
        fulfilment: 'pickup',
      });
    const a = await make('Amaka', '08011112222');
    const b = await make('Bola');
    const c = await make('Chidi');
    await markOrderPaid(actor, b.order.id, { method: 'cash' });
    await cancelOrder(actor, c.order.id);

    expect((await listOrders(actor)).map((o) => o.orderNumber)).toEqual([1003, 1002, 1001]);
    expect((await listOrders(actor, { status: 'open' })).map((o) => o.orderNumber)).toEqual([
      1002, 1001,
    ]);
    expect((await listOrders(actor, { status: 'paid' })).map((o) => o.customerName)).toEqual([
      'Bola',
    ]);
    expect((await listOrders(actor, { search: '#1001' })).map((o) => o.id)).toEqual([a.order.id]);
    expect((await listOrders(actor, { search: 'bol' })).map((o) => o.orderNumber)).toEqual([1002]);
    expect(
      (await listOrders(actor, { search: '0801 111 2222' })).map((o) => o.orderNumber),
    ).toEqual([1001]);
    expect((await listOrders(actor))[2]!.itemCount).toBe(1);

    expect(await countOrdersByStatus(actor)).toMatchObject({
      new: 1,
      paid: 1,
      cancelled: 1,
      delivered: 0,
    });
  });

  it('a product with options gets its option label copied onto the order', async () => {
    const { actor } = await shopWithStock(1);
    const { variants } = await createProduct(
      actor,
      productDraft({
        name: 'Gown',
        options: { kind: 'variants', variants: [{ size: 'M', colour: 'Red', stock: 3 }] },
      }),
    );
    const { items } = await createOrder(actor, {
      customer: { name: 'A' },
      items: [{ variantId: variants[0]!.id, quantity: 1 }],
      fulfilment: 'pickup',
    });
    expect(items[0]).toMatchObject({ productName: 'Gown', variantLabel: 'M / Red' });
  });
});
