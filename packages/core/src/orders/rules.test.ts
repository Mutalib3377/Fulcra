import { describe, expect, it } from 'vitest';
import { canCancelOrder, canMoveOrder, unitPriceFor } from './rules';

describe('order transitions', () => {
  it('allows the normal path and blocks going backwards', () => {
    expect(canMoveOrder('new', 'awaiting_payment')).toBe(true);
    expect(canMoveOrder('awaiting_payment', 'paid')).toBe(true);
    expect(canMoveOrder('paid', 'dispatched')).toBe(true);
    expect(canMoveOrder('dispatched', 'delivered')).toBe(true);
    expect(canMoveOrder('paid', 'delivered')).toBe(true);
    expect(canMoveOrder('delivered', 'new')).toBe(false);
    expect(canMoveOrder('new', 'dispatched')).toBe(false);
    expect(canMoveOrder('cancelled', 'paid')).toBe(false);
  });

  it('can cancel until dispatched', () => {
    expect(canCancelOrder('new')).toBe(true);
    expect(canCancelOrder('paid')).toBe(true);
    expect(canCancelOrder('dispatched')).toBe(false);
    expect(canCancelOrder('delivered')).toBe(false);
  });
});

describe('unitPriceFor', () => {
  const product = { retailPrice: 15_000_00, wholesalePrice: 12_000_00, wholesaleMinQty: 6 };
  it('uses retail, option price, or wholesale by quantity', () => {
    expect(unitPriceFor(product, { priceOverride: null }, 5)).toEqual({
      unitPrice: 15_000_00,
      isWholesale: false,
    });
    expect(unitPriceFor(product, { priceOverride: 16_500_00 }, 1)).toEqual({
      unitPrice: 16_500_00,
      isWholesale: false,
    });
    expect(unitPriceFor(product, { priceOverride: 16_500_00 }, 6)).toEqual({
      unitPrice: 12_000_00,
      isWholesale: true,
    });
    expect(
      unitPriceFor(
        { ...product, wholesalePrice: null, wholesaleMinQty: null },
        { priceOverride: null },
        100,
      ).isWholesale,
    ).toBe(false);
  });
});

describe('paymentMethodLabel', () => {
  it('names every way an order can be paid', async () => {
    const { paymentMethodLabel } = await import('./rules');
    expect(paymentMethodLabel('paystack')).toBe('Paid online');
    expect(paymentMethodLabel('bank_transfer')).toBe('Bank transfer');
    expect(paymentMethodLabel('pos')).toBe('POS');
    expect(paymentMethodLabel('dedicated_nuban')).toBe('Bank transfer');
    expect(paymentMethodLabel('card')).toBe('Card');
    expect(paymentMethodLabel(null)).toBe('');
  });
});
