import { describe, expect, it } from 'vitest';
import {
  findOrCreateCustomer,
  getCustomer,
  listCustomers,
  updateCustomer,
} from '../src/customers/customers';
import {
  archiveDeliveryZone,
  createDeliveryZone,
  listDeliveryZones,
  updateDeliveryZone,
} from '../src/delivery/zones';
import { createOrder, markOrderPaid } from '../src/orders/orders';
import { newBusiness, shopWithStock } from './helpers';

describe('findOrCreateCustomer', () => {
  it('matches by phone in any format and by channel identity', async () => {
    const { actor } = await newBusiness();
    const first = await findOrCreateCustomer(actor, { name: 'Ngozi', phone: '0803 555 0101' });
    expect(first.created).toBe(true);
    const again = await findOrCreateCustomer(actor, { phone: '+234 803 555 0101' });
    expect(again).toMatchObject({ created: false, customer: { id: first.customer.id } });

    // Phone match links the WhatsApp identity; afterwards the identity alone finds them.
    await findOrCreateCustomer(actor, {
      phone: '08035550101',
      identity: { channel: 'whatsapp', externalUserId: '2348035550101' },
    });
    const byIdentity = await findOrCreateCustomer(actor, {
      identity: { channel: 'whatsapp', externalUserId: '2348035550101' },
    });
    expect(byIdentity.customer.id).toBe(first.customer.id);
    expect((await getCustomer(actor, first.customer.id)).identities).toHaveLength(1);

    // An Instagram user with no phone becomes a separate customer, named from their profile.
    const ig = await findOrCreateCustomer(actor, {
      identity: { channel: 'instagram', externalUserId: 'ig-123', displayName: 'ada.styles' },
    });
    expect(ig).toMatchObject({ created: true, customer: { name: 'ada.styles', phone: null } });
  });

  it('rejects bad phones and empty input', async () => {
    const { actor } = await newBusiness();
    await expect(findOrCreateCustomer(actor, { phone: '12345' })).rejects.toThrow();
    await expect(findOrCreateCustomer(actor, {})).rejects.toThrow();
  });

  it('two requests for the same new phone at once create one customer', async () => {
    const { actor } = await newBusiness();
    const [a, b] = await Promise.all([
      findOrCreateCustomer(actor, { name: 'Twin', phone: '08077776666' }),
      findOrCreateCustomer(actor, { name: 'Twin', phone: '08077776666' }),
    ]);
    expect(a.customer.id).toBe(b.customer.id);
    expect(await listCustomers(actor)).toHaveLength(1);
  });
});

describe('customer profile', () => {
  it('updates details and refuses a phone used by another customer', async () => {
    const { actor } = await newBusiness();
    const { customer } = await findOrCreateCustomer(actor, { name: 'Emeka', phone: '08012340000' });
    await findOrCreateCustomer(actor, { name: 'Other', phone: '08012349999' });
    const updated = await updateCustomer(actor, customer.id, {
      name: 'Emeka O.',
      phone: '08012340000',
      email: 'EMEKA@example.com',
      tags: ['VIP', 'vip', 'Wholesale'],
      notes: 'Prefers evening delivery',
    });
    expect(updated).toMatchObject({
      name: 'Emeka O.',
      email: 'emeka@example.com',
      tags: ['vip', 'Wholesale'],
    });
    await expect(
      updateCustomer(actor, customer.id, { name: 'Emeka', phone: '0801 234 9999' }),
    ).rejects.toMatchObject({ code: 'conflict', field: 'phone' });
  });

  it('summarises orders: count, money spent, new vs repeat', async () => {
    const { actor, variant } = await shopWithStock(10);
    const order = (phone: string) =>
      createOrder(actor, {
        customer: { name: 'Repeat', phone },
        items: [{ variantId: variant.id, quantity: 1 }],
        fulfilment: 'pickup',
      });
    const first = await order('08050000001');
    await markOrderPaid(actor, first.order.id, { method: 'cash' });
    await order('08050000001');
    await findOrCreateCustomer(actor, { name: 'Window shopper', phone: '08050000002' });

    const list = await listCustomers(actor);
    const repeat = list.find((c) => c.name === 'Repeat')!;
    expect(repeat).toMatchObject({ orderCount: 2, totalSpent: 1_500_000, kind: 'repeat' });
    expect(list.find((c) => c.name === 'Window shopper')).toMatchObject({
      orderCount: 0,
      kind: 'new',
    });
    expect((await listCustomers(actor, { search: '0805 000 0002' })).map((c) => c.name)).toEqual([
      'Window shopper',
    ]);

    const detail = await getCustomer(actor, repeat.id);
    expect(detail.orders).toHaveLength(2);
    expect(detail).toMatchObject({ totalSpent: 1_500_000, kind: 'repeat' });
  });
});

describe('delivery zones', () => {
  it('creates, edits, refuses duplicate names and archives', async () => {
    const { actor } = await newBusiness();
    const lekki = await createDeliveryZone(actor, {
      name: 'Lekki',
      fee: 200_000,
      estimatedTime: 'Same day',
    });
    await createDeliveryZone(actor, { name: 'Ikeja', fee: 150_000 });
    await expect(createDeliveryZone(actor, { name: 'lekki', fee: 1 })).rejects.toMatchObject({
      code: 'conflict',
      field: 'name',
    });
    await updateDeliveryZone(actor, lekki.id, {
      name: 'Lekki Phase 1',
      fee: 250_000,
      isActive: false,
    });
    expect((await listDeliveryZones(actor, { activeOnly: true })).map((z) => z.name)).toEqual([
      'Ikeja',
    ]);
    await archiveDeliveryZone(actor, lekki.id);
    expect((await listDeliveryZones(actor)).map((z) => z.name)).toEqual(['Ikeja']);
    // The name can be reused once archived.
    await expect(
      createDeliveryZone(actor, { name: 'Lekki Phase 1', fee: 1 }),
    ).resolves.toBeTruthy();
  });

  it('orders cannot use an inactive area', async () => {
    const { actor, zone, variant } = await shopWithStock(5);
    await updateDeliveryZone(actor, zone.id, { name: zone.name, fee: zone.fee, isActive: false });
    await expect(
      createOrder(actor, {
        customer: { name: 'A' },
        items: [{ variantId: variant.id, quantity: 1 }],
        fulfilment: 'delivery',
        deliveryZoneId: zone.id,
        deliveryAddress: 'Somewhere 12',
      }),
    ).rejects.toMatchObject({ field: 'deliveryZoneId' });
  });
});
