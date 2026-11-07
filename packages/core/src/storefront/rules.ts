// Pure storefront rules (no database). Browser-safe via `@fulcra/core/rules`.
import { formatNaira } from '@fulcra/config';

export type StockState = 'in_stock' | 'low' | 'sold_out';

export type StockStatus = { state: StockState; label: string };

/** What the store shows for an amount of stock: "In stock", "Only 2 left" or "Sold out". */
export function storeStockStatus(stock: number, lowStockThreshold: number): StockStatus {
  if (stock <= 0) return { state: 'sold_out', label: 'Sold out' };
  if (stock <= lowStockThreshold) return { state: 'low', label: `Only ${stock} left` };
  return { state: 'in_stock', label: 'In stock' };
}

export type WhatsAppOrderItem = {
  productName: string;
  /** "M / Red"; empty for products without sizes or colours. */
  variantLabel?: string | null | undefined;
  /** Price in kobo. */
  price: number;
  /** Link to the product page, so the seller sees exactly what was chosen. */
  productUrl?: string | null | undefined;
};

/** The message a customer sends when they tap "Order on WhatsApp". */
export function whatsAppOrderMessage(item: WhatsAppOrderItem): string {
  const name = item.variantLabel ? `${item.productName} (${item.variantLabel})` : item.productName;
  const lines = [`Hi! I'd like to order: ${name} – ${formatNaira(item.price)}`];
  if (item.productUrl) lines.push(item.productUrl);
  return lines.join('\n');
}

/** The message for asking about a sold-out product or option. */
export function whatsAppRestockMessage(item: Omit<WhatsAppOrderItem, 'price'>): string {
  const name = item.variantLabel ? `${item.productName} (${item.variantLabel})` : item.productName;
  const lines = [`Hi! Will ${name} be available again?`];
  if (item.productUrl) lines.push(item.productUrl);
  return lines.join('\n');
}

/**
 * A wa.me link to the seller's WhatsApp, with a message already filled in.
 * `phone` is E.164 (+234…); wa.me wants the digits only.
 */
export function whatsAppLink(phone: string, message?: string): string {
  const digits = phone.replace(/\D/g, '');
  const base = `https://wa.me/${digits}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}

/** The default general message from the store home page. */
export function whatsAppHelloMessage(businessName: string): string {
  return `Hi ${businessName}! I saw your store and I'd like to order.`;
}

/** White or near-black text, whichever reads better on a brand colour (#rrggbb). */
export function textColourOn(hex: string): '#ffffff' | '#111827' {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return '#ffffff';
  const [r, g, b] = match.slice(1).map((part) => {
    const c = parseInt(part, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Contrast with white vs with #111827 (luminance ≈ 0.012).
  return 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.062 ? '#ffffff' : '#111827';
}
