import { formatNaira } from '@fulcra/config';
import {
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  type ManualPaymentMethod,
  type OrderStatus,
} from '@fulcra/core/rules';

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

export const ORDER_STATUS_TONES: Record<OrderStatus, Tone> = {
  new: 'info',
  awaiting_payment: 'warning',
  paid: 'success',
  dispatched: 'primary',
  delivered: 'neutral',
  cancelled: 'danger',
};

export function orderStatusLabel(status: OrderStatus): string {
  return ORDER_STATUS_LABELS[status];
}

export type EventLike = {
  type: string;
  orderId: string | null;
  customerId: string | null;
  payload: Record<string, unknown>;
};

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' ? v : 0);

/** Plain-language line for the activity feed, and where it links to. */
export function describeEvent(e: EventLike): { text: string; href: string | null } {
  const p = e.payload;
  const order = `Order #${num(p.orderNumber)}`;
  const orderHref = e.orderId ? `/orders/${e.orderId}` : null;
  switch (e.type) {
    case 'order.created':
      return { text: `${order} created · ${formatNaira(num(p.total))}`, href: orderHref };
    case 'order.status_changed':
      return {
        text: `${order} marked ${ORDER_STATUS_LABELS[str(p.to) as OrderStatus]?.toLowerCase() ?? str(p.to)}`,
        href: orderHref,
      };
    case 'order.paid':
      return {
        text: `${order} marked paid · ${formatNaira(num(p.amount))}${p.method ? ` (${PAYMENT_METHOD_LABELS[str(p.method) as ManualPaymentMethod] ?? str(p.method)})` : ''}`,
        href: orderHref,
      };
    case 'order.cancelled':
      return {
        text: `${order} cancelled${str(p.reason) ? `: ${str(p.reason)}` : ''}`,
        href: orderHref,
      };
    case 'customer.created':
      return {
        text: `New customer: ${str(p.name) || str(p.phone) || 'no name'}`,
        href: e.customerId ? `/customers/${e.customerId}` : null,
      };
    case 'payment.confirmed':
      return { text: `${order} paid online · ${formatNaira(num(p.amount))}`, href: orderHref };
    case 'payment.needs_review':
      return { text: `${order}: a payment needs checking`, href: orderHref };
    case 'stock.low': {
      const label = [
        str(p.productName),
        str(p.variantLabel) === 'Default' ? '' : str(p.variantLabel),
      ]
        .filter(Boolean)
        .join(' – ');
      return {
        text: `Low stock: ${label} (${num(p.stock)} left)`,
        href: p.productId ? `/catalog/${str(p.productId)}` : null,
      };
    }
    default:
      return { text: e.type, href: null };
  }
}

const relative = new Intl.RelativeTimeFormat('en-NG', { numeric: 'auto' });
const dateTime = new Intl.DateTimeFormat('en-NG', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Africa/Lagos',
});

/** "5 minutes ago", "yesterday", or a date for older times. */
export function timeAgo(date: Date, now = new Date()): string {
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return 'just now';
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), 'hour');
  if (abs < 7 * 86_400) return relative.format(Math.round(seconds / 86_400), 'day');
  return dateTime.format(date);
}

export function formatDateTime(date: Date): string {
  return dateTime.format(date);
}
