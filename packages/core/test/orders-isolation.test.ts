import { describe, expect, it } from 'vitest';
import { getCustomer, listCustomers, updateCustomer } from '../src/customers/customers';
import { listDeliveryZones, updateDeliveryZone } from '../src/delivery/zones';
import { listEvents } from '../src/events/events';
import {
  cancelOrder,
  createOrder,
  getOrder,
  listOrders,
  markOrderPaid,
  updateOrderStatus,
} from '../src/orders/orders';
import { shopWithStock } from './helpers';

describe('orders isolation between two businesses', () => {
  it('B cannot see or touch A’s orders, customers, zones or events', async () => {
    const a = await shopWithStock(5);
    const b = await shopWithStock(5);
    const { order, customer } = await createOrder(a.actor, {
      customer: { name: 'A’s customer', phone: '08031110000' },
      items: [{ variantId: a.variant.id, quantity: 1 }],
      fulfilment: 'delivery',
      deliveryZoneId: a.zone.id,
      deliveryAddress: '1 Business A Road',
    });

    expect(await listOrders(b.actor)).toEqual([]);
    expect(await listCustomers(b.actor)).toEqual([]);
    expect((await listDeliveryZones(b.actor)).map((z) => z.id)).toEqual([b.zone.id]);
    expect((await listEvents(b.actor)).some((e) => e.orderId === order.id)).toBe(false);

    await expect(getOrder(b.actor, order.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(markOrderPaid(b.actor, order.id, { method: 'cash' })).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(updateOrderStatus(b.actor, order.id, 'awaiting_payment')).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(cancelOrder(b.actor, order.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(getCustomer(b.actor, customer.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(updateCustomer(b.actor, customer.id, { name: 'Hacked' })).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      updateDeliveryZone(b.actor, a.zone.id, { name: 'Hacked', fee: 0 }),
    ).rejects.toMatchObject({ code: 'not_found' });

    // Same phone at B is a different customer.
    const atB = await createOrder(b.actor, {
      customer: { phone: '08031110000', name: 'Same person' },
      items: [{ variantId: b.variant.id, quantity: 1 }],
      fulfilment: 'pickup',
    });
    expect(atB.customer.id).not.toBe(customer.id);
    expect(atB.order.orderNumber).toBe(1001);

    expect((await getOrder(a.actor, order.id)).order.status).toBe('new');
  });

  it('B cannot build an order from A’s products, zones or customers', async () => {
    const a = await shopWithStock(5);
    const b = await shopWithStock(5);
    const { customer } = await createOrder(a.actor, {
      customer: { name: 'X' },
      items: [{ variantId: a.variant.id, quantity: 1 }],
      fulfilment: 'pickup',
    });

    await expect(
      createOrder(b.actor, {
        customer: { name: 'Y' },
        items: [{ variantId: a.variant.id, quantity: 1 }],
        fulfilment: 'pickup',
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      createOrder(b.actor, {
        customer: { name: 'Y' },
        items: [{ variantId: b.variant.id, quantity: 1 }],
        fulfilment: 'delivery',
        deliveryZoneId: a.zone.id,
        deliveryAddress: '1 Somewhere',
      }),
    ).rejects.toMatchObject({ field: 'deliveryZoneId' });
    await expect(
      createOrder(b.actor, {
        customer: { id: customer.id },
        items: [{ variantId: b.variant.id, quantity: 1 }],
        fulfilment: 'pickup',
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
