import { describe, expect, it } from 'vitest';
import { describeEvent, timeAgo } from './orders';

describe('describeEvent', () => {
  it('writes plain-language activity lines with links', () => {
    expect(
      describeEvent({
        type: 'order.created',
        orderId: 'o1',
        customerId: null,
        payload: { orderNumber: 1001, total: 150000 },
      }),
    ).toEqual({
      text: 'Order #1001 created · ₦1,500.00',
      href: '/orders/o1',
    });
    expect(
      describeEvent({
        type: 'order.status_changed',
        orderId: 'o1',
        customerId: null,
        payload: { orderNumber: 1001, to: 'dispatched' },
      }).text,
    ).toBe('Order #1001 marked dispatched');
    expect(
      describeEvent({
        type: 'order.paid',
        orderId: 'o1',
        customerId: null,
        payload: { orderNumber: 1001, amount: 150000, method: 'cash' },
      }).text,
    ).toBe('Order #1001 paid · ₦1,500.00 (Cash)');
    expect(
      describeEvent({
        type: 'stock.low',
        orderId: null,
        customerId: null,
        payload: { productId: 'p1', productName: 'Gown', variantLabel: 'M / Red', stock: 2 },
      }),
    ).toEqual({
      text: 'Low stock: Gown – M / Red (2 left)',
      href: '/catalog/p1',
    });
  });
});

describe('timeAgo', () => {
  it('uses friendly relative times', () => {
    const now = new Date('2026-11-06T12:00:00Z');
    expect(timeAgo(new Date('2026-11-06T11:59:30Z'), now)).toBe('just now');
    expect(timeAgo(new Date('2026-11-06T11:55:00Z'), now)).toBe('5 minutes ago');
    expect(timeAgo(new Date('2026-11-05T12:00:00Z'), now)).toBe('yesterday');
  });
});
