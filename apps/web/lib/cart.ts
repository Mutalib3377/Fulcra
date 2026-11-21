import 'server-only';
import { CART_COOKIE, parseCart, serializeCart, type CartLine } from '@fulcra/core/rules';
import type { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

/**
 * The store cart lives in a cookie on the shopper's phone (variant ids and quantities only,
 * never prices), so adding to cart works without JavaScript (K1). Each store address has its
 * own cookie (host-only).
 */
const MAX_AGE = 60 * 60 * 24 * 30;

export async function readCart(): Promise<CartLine[]> {
  return parseCart((await cookies()).get(CART_COOKIE)?.value);
}

export function writeCart(response: NextResponse, lines: CartLine[]) {
  if (lines.length === 0) {
    response.cookies.delete(CART_COOKIE);
    return;
  }
  response.cookies.set(CART_COOKIE, serializeCart(lines), {
    path: '/',
    maxAge: MAX_AGE,
    sameSite: 'lax',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  });
}

/** The shopper's details from their last checkout on this store, to fill the form again. */
export const CHECKOUT_DETAILS_COOKIE = 'fulcra_checkout';
export type CheckoutDetails = {
  name: string;
  phone: string;
  email: string;
  fulfilment: 'delivery' | 'pickup';
  deliveryZoneId: string;
  deliveryAddress: string;
};

export async function readCheckoutDetails(): Promise<Partial<CheckoutDetails>> {
  try {
    const raw = (await cookies()).get(CHECKOUT_DETAILS_COOKIE)?.value;
    const value = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const str = (k: string) =>
      typeof value[k] === 'string' ? (value[k] as string).slice(0, 300) : '';
    return {
      name: str('name'),
      phone: str('phone'),
      email: str('email'),
      fulfilment: value.fulfilment === 'pickup' ? 'pickup' : 'delivery',
      deliveryZoneId: str('deliveryZoneId'),
      deliveryAddress: str('deliveryAddress'),
    };
  } catch {
    return {};
  }
}

export function writeCheckoutDetails(response: NextResponse, details: CheckoutDetails) {
  response.cookies.set(CHECKOUT_DETAILS_COOKIE, JSON.stringify(details), {
    path: '/',
    maxAge: MAX_AGE,
    sameSite: 'lax',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  });
}

/**
 * Forms on the store post to the same address. Refuse posts sent from other sites (a page
 * elsewhere must not start checkouts or fill carts for a shopper).
 */
export function fromSameSite(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true; // old browsers send none; the limits still apply
  try {
    return new URL(origin).host === request.headers.get('host');
  } catch {
    return false;
  }
}
