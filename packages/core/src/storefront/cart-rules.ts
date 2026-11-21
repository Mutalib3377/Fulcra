/**
 * Store cart and checkout rules (K1). Browser-safe: the store keeps the cart in a cookie on the
 * shopper's phone (so it works without JavaScript); prices are never stored in it.
 */

/** Unpaid store orders are cancelled after this long, so their stock goes back on sale. */
export const STORE_CHECKOUT_MINUTES = 30;
/** Different products/options in one cart. */
export const MAX_CART_LINES = 20;
/** Pieces of one option in one cart. */
export const MAX_CART_QUANTITY = 20;
export const CART_COOKIE = 'fulcra_cart';

export type CartLine = { variantId: string; quantity: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads a cart cookie ("<variantId>:<qty>,…"); anything malformed is dropped. */
export function parseCart(value: string | null | undefined): CartLine[] {
  const lines = new Map<string, number>();
  for (const part of (value ?? '').split(',')) {
    const [id, qty] = part.split(':');
    const quantity = Number(qty);
    if (!id || !UUID.test(id) || !Number.isInteger(quantity) || quantity < 1) continue;
    lines.set(
      id.toLowerCase(),
      Math.min(MAX_CART_QUANTITY, (lines.get(id.toLowerCase()) ?? 0) + quantity),
    );
  }
  return [...lines]
    .slice(0, MAX_CART_LINES)
    .map(([variantId, quantity]) => ({ variantId, quantity }));
}

export function serializeCart(lines: CartLine[]): string {
  return lines
    .slice(0, MAX_CART_LINES)
    .map((l) => `${l.variantId}:${Math.min(MAX_CART_QUANTITY, l.quantity)}`)
    .join(',');
}

/** Adds pieces of an option (capped). */
export function addToCart(lines: CartLine[], variantId: string, quantity: number): CartLine[] {
  const id = variantId.toLowerCase();
  const existing = lines.find((l) => l.variantId === id);
  if (existing) {
    return lines.map((l) =>
      l.variantId === id
        ? { ...l, quantity: Math.min(MAX_CART_QUANTITY, l.quantity + quantity) }
        : l,
    );
  }
  if (lines.length >= MAX_CART_LINES) return lines;
  return [...lines, { variantId: id, quantity: Math.min(MAX_CART_QUANTITY, quantity) }];
}

/** Sets the pieces of an option; 0 removes it. */
export function setCartQuantity(
  lines: CartLine[],
  variantId: string,
  quantity: number,
): CartLine[] {
  const id = variantId.toLowerCase();
  if (quantity <= 0) return lines.filter((l) => l.variantId !== id);
  return lines.map((l) =>
    l.variantId === id ? { ...l, quantity: Math.min(MAX_CART_QUANTITY, quantity) } : l,
  );
}

export function cartCount(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.quantity, 0);
}
