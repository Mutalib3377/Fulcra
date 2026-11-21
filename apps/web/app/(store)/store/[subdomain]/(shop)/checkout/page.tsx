import { formatNaira } from '@fulcra/config';
import { getStoreCart } from '@fulcra/core';
import { Lock, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { readCart, readCheckoutDetails } from '@/lib/cart';
import { imageUrls } from '@/lib/images';
import { loadStore } from '@/lib/store';
import { CheckoutTotal } from '../../_components/checkout-total';

type Props = {
  params: Promise<{ subdomain: string }>;
  searchParams: Promise<{ error?: string; field?: string }>;
};

export const metadata: Metadata = { title: 'Checkout', robots: { index: false } };

const input =
  'min-h-12 w-full rounded-[calc(var(--store-radius)*0.75)] bg-white px-4 text-base ring-1 ring-black/15 outline-none focus:ring-2 focus:ring-[var(--store-primary)]';

/**
 * Checkout (K1): one plain form. "Pay now" posts to /checkout/start, which creates the order
 * and sends the shopper to Paystack. Prices and fees are worked out again on the server.
 */
export default async function CheckoutPage({ params, searchParams }: Props) {
  const { subdomain } = await params;
  const store = await loadStore(subdomain);
  if (!store) notFound();
  const cart = await getStoreCart(store.businessId, await readCart());
  // Nothing to pay for, or the store takes orders on WhatsApp only: back to the cart.
  if (cart.lines.length === 0 || !cart.checkoutOpen || cart.lines.some((l) => l.problem)) {
    redirect('/cart');
  }
  const { error, field } = await searchParams;
  const saved = await readCheckoutDetails();
  const zones = cart.deliveryZones;
  const fulfilment = zones.length === 0 ? 'pickup' : (saved.fulfilment ?? 'delivery');
  const zoneId = zones.some((z) => z.id === saved.deliveryZoneId) ? saved.deliveryZoneId : '';
  const fieldError = (name: string) =>
    error && field === name ? (
      <p className="text-sm font-medium text-[#b91c1c]" id={`${name}-error`}>
        {error}
      </p>
    ) : null;

  return (
    <main className="mx-auto grid w-full max-w-5xl flex-1 gap-8 px-4 py-8 md:grid-cols-[1fr_22rem]">
      <form method="post" action="/checkout/start" className="flex flex-col gap-6" id="checkout">
        <h1 className="store-display text-4xl">Checkout</h1>
        {error &&
        !['name', 'phone', 'email', 'deliveryZoneId', 'deliveryAddress'].includes(field ?? '') ? (
          <p
            role="alert"
            className="rounded-[var(--store-radius)] bg-[#fef2f2] px-4 py-3 text-sm font-medium text-[#b91c1c]"
          >
            {error}
          </p>
        ) : null}

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 font-semibold">Your details</legend>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Your name
            <input
              name="name"
              required
              autoComplete="name"
              defaultValue={saved.name}
              className={input}
              aria-invalid={field === 'name'}
            />
          </label>
          {fieldError('name')}
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Phone number
            <input
              name="phone"
              required
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="0803 123 4567"
              defaultValue={saved.phone}
              className={input}
              aria-invalid={field === 'phone'}
            />
          </label>
          {fieldError('phone')}
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Email{' '}
            <span className="font-normal text-[#6b7280]">(optional, for your payment receipt)</span>
            <input
              name="email"
              type="email"
              autoComplete="email"
              defaultValue={saved.email}
              className={input}
              aria-invalid={field === 'email'}
            />
          </label>
          {fieldError('email')}
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 font-semibold">How do you want it?</legend>
          {zones.length > 0 ? (
            <label className="flex cursor-pointer items-start gap-3 rounded-[var(--store-radius)] p-4 ring-1 ring-black/10 has-[:checked]:ring-2 has-[:checked]:ring-[var(--store-primary)]">
              <input
                type="radio"
                name="fulfilment"
                value="delivery"
                defaultChecked={fulfilment === 'delivery'}
                className="mt-1 size-4 accent-[var(--store-primary)]"
              />
              <span className="flex flex-1 flex-col gap-3">
                <span className="font-medium">Deliver to me</span>
                <select
                  name="deliveryZoneId"
                  defaultValue={zoneId}
                  className={input}
                  aria-label="Delivery area"
                  aria-invalid={field === 'deliveryZoneId'}
                >
                  <option value="">Choose your area</option>
                  {zones.map((z) => (
                    <option key={z.id} value={z.id} data-fee={z.fee}>
                      {z.name} – {formatNaira(z.fee)}
                      {z.estimatedTime ? ` (${z.estimatedTime})` : ''}
                    </option>
                  ))}
                </select>
                {fieldError('deliveryZoneId')}
                <textarea
                  name="deliveryAddress"
                  rows={2}
                  placeholder="House number, street, landmark"
                  defaultValue={saved.deliveryAddress}
                  className={`${input} py-3`}
                  aria-label="Delivery address"
                  aria-invalid={field === 'deliveryAddress'}
                />
                {fieldError('deliveryAddress')}
              </span>
            </label>
          ) : null}
          <label className="flex cursor-pointer items-start gap-3 rounded-[var(--store-radius)] p-4 ring-1 ring-black/10 has-[:checked]:ring-2 has-[:checked]:ring-[var(--store-primary)]">
            <input
              type="radio"
              name="fulfilment"
              value="pickup"
              defaultChecked={fulfilment === 'pickup'}
              className="mt-1 size-4 accent-[var(--store-primary)]"
            />
            <span className="flex flex-col">
              <span className="font-medium">I&apos;ll pick it up</span>
              <span className="text-sm text-[#6b7280]">
                Free. The shop will tell you where and when.
              </span>
            </span>
          </label>
        </fieldset>
      </form>

      <aside className="flex flex-col gap-4 self-start rounded-[var(--store-radius)] bg-[var(--store-tint)] p-5 md:sticky md:top-20">
        <h2 className="font-semibold">Your order</h2>
        <ul className="flex flex-col gap-3">
          {cart.lines.map((l) => (
            <li key={l.variantId} className="flex items-center gap-3 text-sm">
              <span className="relative size-12 shrink-0 overflow-hidden rounded-[calc(var(--store-radius)*0.6)] bg-white">
                {l.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element -- pre-sized storage image
                  <img src={imageUrls(l.photo).sm} alt="" className="size-full object-cover" />
                ) : null}
                <span className="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full bg-[#111827] text-[10px] font-semibold text-white">
                  {l.quantity}
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-1">{l.productName}</span>
                {l.variantLabel ? (
                  <span className="text-xs text-[#6b7280]">{l.variantLabel}</span>
                ) : null}
              </span>
              <span className="font-medium">{formatNaira(l.lineTotal)}</span>
            </li>
          ))}
        </ul>
        <CheckoutTotal subtotal={cart.subtotal} />
        <button
          type="submit"
          form="checkout"
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 text-base font-semibold shadow-sm"
          style={{ backgroundColor: 'var(--store-primary)', color: 'var(--store-on-primary)' }}
        >
          <Lock className="size-4" aria-hidden /> Pay now
        </button>
        <p className="flex items-start gap-2 text-xs text-[#4b5563]">
          <ShieldCheck className="size-4 shrink-0" aria-hidden />
          You&apos;ll pay on Paystack&apos;s secure page by card, bank transfer or USSD. The money
          goes straight to {store.name}.
        </p>
        <a
          href="/cart"
          className="text-center text-sm text-[#4b5563] underline-offset-4 hover:underline"
        >
          Back to cart
        </a>
      </aside>
    </main>
  );
}
