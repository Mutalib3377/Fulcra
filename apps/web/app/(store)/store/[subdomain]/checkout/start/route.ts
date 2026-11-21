import { isCoreError, startStoreCheckout } from '@fulcra/core';
import { CART_COOKIE, parseCart } from '@fulcra/core/rules';
import { NextResponse, type NextRequest } from 'next/server';
import { fromSameSite, writeCart, writeCheckoutDetails, type CheckoutDetails } from '@/lib/cart';
import { clientIp } from '@/lib/rate-limit';
import { loadStore } from '@/lib/store';
import { storeUrl } from '@/lib/urls';

type Context = { params: Promise<{ subdomain: string }> };

const text = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim().slice(0, 300) : '';
};

/**
 * "Pay now" on the checkout page (a plain form): Core creates the order and the Paystack page,
 * then the shopper goes to Paystack. Problems come back to the checkout page as a message.
 */
export async function POST(request: NextRequest, { params }: Context) {
  const { subdomain } = await params;
  if (!fromSameSite(request)) return new NextResponse('Forbidden', { status: 403 });
  const store = await loadStore(subdomain);
  if (!store) return new NextResponse('Not found', { status: 404 });
  const form = await request.formData();
  const details: CheckoutDetails = {
    name: text(form, 'name'),
    phone: text(form, 'phone'),
    email: text(form, 'email'),
    fulfilment: text(form, 'fulfilment') === 'pickup' ? 'pickup' : 'delivery',
    deliveryZoneId: text(form, 'deliveryZoneId'),
    deliveryAddress: text(form, 'deliveryAddress'),
  };
  const items = parseCart(request.cookies.get(CART_COOKIE)?.value);
  try {
    const result = await startStoreCheckout(
      store.businessId,
      {
        ...details,
        items,
        deliveryZoneId: details.fulfilment === 'delivery' ? details.deliveryZoneId || null : null,
      },
      { key: clientIp(request) },
    );
    // Paystack's page; the shopper comes back to the store's receipt page.
    const response = NextResponse.redirect(result.paymentUrl, 303);
    writeCart(response, []);
    writeCheckoutDetails(response, details);
    return response;
  } catch (error) {
    if (!isCoreError(error)) throw error;
    const back = new URLSearchParams({ error: error.message });
    if (error.field) back.set('field', error.field);
    const response = NextResponse.redirect(storeUrl(subdomain, `/checkout?${back}`), 303);
    // Keep what they typed so the form comes back filled in.
    writeCheckoutDetails(response, details);
    return response;
  }
}
