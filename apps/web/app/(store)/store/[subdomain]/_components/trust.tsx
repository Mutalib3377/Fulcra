import type { StoreInfo } from '@fulcra/core';
import { MessageCircle, ShieldCheck, Truck } from 'lucide-react';

/** What this store can promise, from its real setup (never made up). */
export function trustItems(store: StoreInfo) {
  const { securePayments, deliveryAreas, deliveryAreaCount } = store.trust;
  const items: { key: string; icon: typeof Truck; title: string; text: string }[] = [];
  if (securePayments)
    items.push({
      key: 'pay',
      icon: ShieldCheck,
      title: 'Secure payment',
      text: 'Card, transfer or USSD through Paystack',
    });
  if (deliveryAreaCount > 0) {
    const more = deliveryAreaCount - Math.min(deliveryAreas.length, 2);
    items.push({
      key: 'delivery',
      icon: Truck,
      title: 'Delivery available',
      text: `${deliveryAreas.slice(0, 2).join(', ')}${more > 0 ? ` and ${more} more` : ''}`,
    });
  }
  items.push({
    key: 'chat',
    icon: MessageCircle,
    title: 'Quick answers',
    text: 'Ask anything on WhatsApp before you buy',
  });
  return items;
}

/** The promises as a compact list (product page, under the order button). */
export function TrustList({ store }: { store: StoreInfo }) {
  return (
    <ul className="flex flex-col divide-y divide-black/5 rounded-[var(--store-radius)] bg-[var(--store-tint)] px-4">
      {trustItems(store).map(({ key, icon: Icon, title, text }) => (
        <li key={key} className="flex items-center gap-3 py-3">
          <Icon className="size-5 shrink-0 text-[var(--store-ink)]" aria-hidden />
          <span className="text-sm">
            <span className="font-semibold">{title}</span>
            <span className="text-[#4b5563]"> · {text}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
