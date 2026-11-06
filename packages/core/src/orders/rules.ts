// Pure order rules (no database). Browser-safe via `@fulcra/core/rules`.
import type { OrderStatus } from '@fulcra/db/schema';

export const ORDER_STATUSES = [
  'new',
  'awaiting_payment',
  'paid',
  'dispatched',
  'delivered',
  'cancelled',
] as const satisfies readonly OrderStatus[];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: 'New',
  awaiting_payment: 'Awaiting payment',
  paid: 'Paid',
  dispatched: 'Dispatched',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

/**
 * Allowed moves. Payment ("paid") is recorded with `markOrderPaid`; cancelling with
 * `cancelOrder`. A paid pickup order can go straight to delivered (collected).
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  new: ['awaiting_payment', 'paid', 'cancelled'],
  awaiting_payment: ['paid', 'cancelled'],
  paid: ['dispatched', 'delivered', 'cancelled'],
  dispatched: ['delivered'],
  delivered: [],
  cancelled: [],
};

export function canMoveOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/** Orders that still hold stock and can be cancelled (stock goes back). */
export function canCancelOrder(status: OrderStatus): boolean {
  return canMoveOrder(status, 'cancelled');
}

export type PricedProduct = {
  retailPrice: number;
  wholesalePrice: number | null;
  wholesaleMinQty: number | null;
};

/**
 * Unit price for a line: the option's own price (or the product price), switching to the
 * wholesale price when the line's quantity reaches the wholesale minimum.
 */
export function unitPriceFor(
  product: PricedProduct,
  variant: { priceOverride: number | null },
  quantity: number,
): { unitPrice: number; isWholesale: boolean } {
  if (
    product.wholesalePrice !== null &&
    product.wholesaleMinQty !== null &&
    quantity >= product.wholesaleMinQty
  ) {
    return { unitPrice: product.wholesalePrice, isWholesale: true };
  }
  return { unitPrice: variant.priceOverride ?? product.retailPrice, isWholesale: false };
}

export const PAYMENT_METHODS = ['cash', 'transfer', 'pos', 'other'] as const;
export type ManualPaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<ManualPaymentMethod, string> = {
  cash: 'Cash',
  transfer: 'Bank transfer',
  pos: 'POS',
  other: 'Other',
};

/** Plain-language name for how an order was paid (manual methods, payment link, transfer). */
export function paymentMethodLabel(method: string | null | undefined): string {
  if (!method) return '';
  if (method === 'paystack') return 'Paid online';
  if (method === 'bank_transfer' || method === 'dedicated_nuban') return 'Bank transfer';
  const paystackChannels: Record<string, string> = {
    card: 'Card',
    ussd: 'USSD',
    bank: 'Bank',
    qr: 'QR code',
    mobile_money: 'Mobile money',
  };
  if (paystackChannels[method]) return paystackChannels[method];
  return PAYMENT_METHOD_LABELS[method as ManualPaymentMethod] ?? method.replace(/_/g, ' ');
}
