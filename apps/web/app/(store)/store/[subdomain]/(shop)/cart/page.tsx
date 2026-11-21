import { formatNaira } from '@fulcra/config';
import { whatsAppLink } from '@fulcra/core';
import { MAX_CART_QUANTITY } from '@fulcra/core/rules';
import { ArrowRight, Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { readCart } from '@/lib/cart';
import { imageUrls } from '@/lib/images';
import { loadStore } from '@/lib/store';
import { storeUrl } from '@/lib/urls';
import { getStoreCart } from '@fulcra/core';
import { WhatsAppButton } from '../../_components/whatsapp-button';

type Props = {
  params: Promise<{ subdomain: string }>;
  searchParams: Promise<{ added?: string }>;
};

export const metadata: Metadata = { title: 'Your cart', robots: { index: false } };

/** The cart (K1): priced on the server, changed with plain forms, works without JavaScript. */
export default async function CartPage({ params, searchParams }: Props) {
  const { subdomain } = await params;
  const store = await loadStore(subdomain);
  if (!store) notFound();
  const cart = await getStoreCart(store.businessId, await readCart());
  const { added } = await searchParams;
  const blocked = cart.lines.some((l) => l.problem !== null);
  const buyable = cart.lines.filter((l) => l.problem !== 'unavailable');
  // Without store payments, the cart becomes a WhatsApp order message.
  const orderMessage = [
    `Hi! I'd like to order from ${store.name}:`,
    ...buyable.map(
      (l) =>
        `• ${l.quantity} × ${l.productName}${l.variantLabel ? ` (${l.variantLabel})` : ''} – ${formatNaira(l.lineTotal)}`,
    ),
    `Total: ${formatNaira(cart.subtotal)} + delivery`,
  ].join('\n');

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-1">
        <h1 className="store-display store-title text-4xl">Your cart</h1>
        {added && cart.lines.length > 0 ? (
          <p className="text-sm font-medium text-(--store-success)" role="status">
            Added to your cart.
          </p>
        ) : null}
      </div>

      {cart.lines.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-[var(--store-radius)] bg-[var(--store-tint)] px-6 py-14 text-center">
          <ShoppingBag className="size-10 text-[var(--store-ink)] opacity-60" aria-hidden />
          <h2 className="store-display text-xl">Your cart is empty</h2>
          <a
            href="/products"
            className="inline-flex min-h-12 items-center gap-2 rounded-(--store-button-radius) px-6 font-semibold"
            style={{ backgroundColor: 'var(--store-primary)', color: 'var(--store-on-primary)' }}
          >
            Start shopping <ArrowRight className="size-4" aria-hidden />
          </a>
        </div>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-(--store-line)">
            {cart.lines.map((line) => {
              const photo = line.photo ? imageUrls(line.photo).sm : null;
              return (
                <li key={line.variantId} className="flex gap-4 py-4">
                  <a
                    href={`/p/${line.productId}`}
                    className="size-20 shrink-0 overflow-hidden bg-[var(--store-tint)]"
                    style={{ borderRadius: 'calc(var(--store-radius) * 0.75)' }}
                  >
                    {photo ? (
                      // eslint-disable-next-line @next/next/no-img-element -- pre-sized storage image
                      <img src={photo} alt="" className="size-full object-cover" />
                    ) : null}
                  </a>
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <a href={`/p/${line.productId}`} className="font-medium">
                          {line.productName}
                        </a>
                        {line.variantLabel ? (
                          <p className="text-sm text-(--store-subtle)">{line.variantLabel}</p>
                        ) : null}
                      </div>
                      <p className="shrink-0 font-semibold">{formatNaira(line.lineTotal)}</p>
                    </div>
                    {line.problem === 'unavailable' ? (
                      <p className="text-sm font-medium text-(--store-danger)">
                        No longer available. Please remove it.
                      </p>
                    ) : line.problem === 'not_enough' ? (
                      <p className="text-sm font-medium text-(--store-warning)">
                        {line.available === 0
                          ? 'Sold out. Please remove it.'
                          : `Only ${line.available} left. Lower the quantity to continue.`}
                      </p>
                    ) : (
                      <p className="text-xs text-(--store-subtle)">
                        {formatNaira(line.unitPrice)} each
                        {line.isWholesale ? ' (wholesale price)' : ''}
                      </p>
                    )}
                    <div className="flex items-center gap-2">
                      <QuantityButton
                        line={line.variantId}
                        quantity={line.quantity - 1}
                        label="One less"
                      >
                        <Minus className="size-4" aria-hidden />
                      </QuantityButton>
                      <span className="min-w-8 text-center font-semibold" aria-label="Quantity">
                        {line.quantity}
                      </span>
                      <QuantityButton
                        line={line.variantId}
                        quantity={line.quantity + 1}
                        label="One more"
                        disabled={line.quantity >= Math.min(MAX_CART_QUANTITY, line.available)}
                      >
                        <Plus className="size-4" aria-hidden />
                      </QuantityButton>
                      <form method="post" action="/cart/update" className="ml-auto">
                        <input type="hidden" name="variantId" value={line.variantId} />
                        <input type="hidden" name="quantity" value="0" />
                        <button
                          type="submit"
                          className="inline-flex min-h-10 items-center gap-1.5 rounded-(--store-button-radius) px-3 text-sm text-(--store-subtle) hover:bg-[var(--store-tint)]"
                        >
                          <Trash2 className="size-4" aria-hidden /> Remove
                        </button>
                      </form>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <section className="flex flex-col gap-4 rounded-[var(--store-radius)] bg-[var(--store-tint)] p-5">
            <div className="flex items-center justify-between text-lg">
              <span>Subtotal</span>
              <span className="font-semibold">{formatNaira(cart.subtotal)}</span>
            </div>
            <p className="text-sm text-(--store-muted)">
              Delivery is added at checkout, or choose pickup.
            </p>
            {cart.checkoutOpen ? (
              blocked ? (
                <p className="rounded-[var(--store-radius)] bg-(--store-surface) px-4 py-3 text-sm font-medium text-(--store-warning)">
                  Fix the items marked above to continue.
                </p>
              ) : (
                <a
                  href="/checkout"
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-(--store-button-radius) px-6 text-base font-semibold shadow-sm"
                  style={{
                    backgroundColor: 'var(--store-primary)',
                    color: 'var(--store-on-primary)',
                  }}
                >
                  Checkout <ArrowRight className="size-4" aria-hidden />
                </a>
              )
            ) : null}
            <WhatsAppButton
              href={whatsAppLink(
                store.whatsappNumber,
                `${orderMessage}\n${storeUrl(store.subdomain)}`,
              )}
              className={
                cart.checkoutOpen
                  ? 'bg-(--store-surface) text-[#1f8f4e] shadow-none ring-1 ring-(--store-line) hover:bg-(--store-surface)'
                  : ''
              }
            >
              {cart.checkoutOpen ? 'Or order on WhatsApp' : 'Send this order on WhatsApp'}
            </WhatsAppButton>
          </section>
        </>
      )}
    </main>
  );
}

function QuantityButton({
  line,
  quantity,
  label,
  disabled,
  children,
}: {
  line: string;
  quantity: number;
  label: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <form method="post" action="/cart/update">
      <input type="hidden" name="variantId" value={line} />
      <input type="hidden" name="quantity" value={Math.max(0, quantity)} />
      <button
        type="submit"
        aria-label={label}
        disabled={disabled}
        className="inline-flex size-10 items-center justify-center rounded-full ring-1 ring-(--store-line) hover:bg-[var(--store-tint)] disabled:opacity-40"
      >
        {children}
      </button>
    </form>
  );
}
