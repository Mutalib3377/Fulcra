import { formatNaira } from '@fulcra/config';
import {
  storeUrl,
  whatsAppLink,
  whatsAppOrderMessage,
  whatsAppRestockMessage,
  type StoreVariant,
} from '@fulcra/core';
import { cn } from '@fulcra/ui';
import { Package, ShoppingBag } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { imageUrls } from '@/lib/images';
import { loadStore, loadStoreProduct, loadStoreProducts } from '@/lib/store';
import { ProductGrid } from '../../../_components/product-grid';
import { shareMetadata } from '../../../_components/share';
import { ShareButton } from '../../../_components/share-button';
import { TrustList } from '../../../_components/trust';
import { WhatsAppButton } from '../../../_components/whatsapp-button';

type Props = {
  params: Promise<{ subdomain: string; productId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { subdomain, productId } = await params;
  const store = await loadStore(subdomain);
  if (!store) return {};
  const product = await loadStoreProduct(store.businessId, productId);
  if (!product) return { title: 'Not found', robots: { index: false } };
  const price = `${product.hasPriceRange ? 'From ' : ''}${formatNaira(product.price)}`;
  const summary = product.description.replace(/\s+/g, ' ').trim().slice(0, 150);
  return {
    title: product.name,
    ...shareMetadata(store, {
      path: `/p/${product.id}`,
      title: `${product.name} – ${price}`,
      description: summary || `${price} at ${store.name}. Order on WhatsApp.`,
      image: product.photos[0] ?? store.brand.logo,
    }),
  };
}

export default async function ProductPage({ params, searchParams }: Props) {
  const { subdomain, productId } = await params;
  const store = await loadStore(subdomain);
  if (!store) notFound();
  const product = await loadStoreProduct(store.businessId, productId);
  if (!product) notFound();

  const wanted = firstValue((await searchParams).v);
  // A product without sizes or colours has one hidden option, always "chosen".
  const chosen = product.hasOptions
    ? (product.variants.find((variant) => variant.id === wanted) ?? null)
    : (product.variants[0] ?? null);
  const productUrl = storeUrl(store.subdomain, `/p/${product.id}`);
  const price = chosen ? chosen.price : product.price;
  const priceText = `${!chosen && product.hasPriceRange ? 'From ' : ''}${formatNaira(price)}`;
  const related = await relatedProducts(store.businessId, product.id, product.category);
  // Store payments on, and this option can be bought now: add to cart first, WhatsApp second.
  const canAddToCart = store.checkout && chosen !== null && chosen.stock.state !== 'sold_out';
  const order = (
    <OrderButton
      whatsappNumber={store.whatsappNumber}
      productName={product.name}
      productUrl={productUrl}
      chosen={chosen}
      soldOut={product.soldOut}
    />
  );

  return (
    <main className="flex flex-1 flex-col pb-24 md:pb-0">
      <div className="mx-auto grid w-full max-w-6xl gap-6 md:grid-cols-2 md:gap-12 md:px-4 md:py-8">
        <Gallery name={product.name} photos={product.photos.map((photo) => imageUrls(photo))} />

        <div className="flex flex-col gap-6 px-4 md:px-0">
          <div className="flex flex-col gap-3">
            <nav className="flex items-center gap-1.5 text-sm text-[#6b7280]">
              <a href="/" className="hover:text-[#111827]">
                Home
              </a>
              {product.category ? (
                <>
                  <span aria-hidden>/</span>
                  <a
                    href={`/c/${encodeURIComponent(product.category)}`}
                    className="hover:text-[#111827]"
                  >
                    {product.category}
                  </a>
                </>
              ) : null}
            </nav>
            <h1 className="store-display text-[2rem] leading-tight text-balance md:text-4xl">
              {product.name}
            </h1>
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-2xl font-semibold tracking-tight">{priceText}</p>
              {chosen ? (
                <StockPill state={chosen.stock.state} label={chosen.stock.label} />
              ) : product.soldOut ? (
                <StockPill state="sold_out" label="Sold out" />
              ) : null}
            </div>
            {product.wholesale ? (
              <p className="flex items-center gap-2 rounded-[var(--store-radius)] bg-[var(--store-tint)] px-3 py-2.5 text-sm">
                <Package className="size-4 shrink-0 text-[var(--store-ink)]" aria-hidden />
                <span>
                  <span className="font-semibold">Buying in bulk?</span>{' '}
                  {formatNaira(product.wholesale.price)} each from {product.wholesale.minQty} pieces
                </span>
              </p>
            ) : null}
          </div>

          {product.hasOptions ? (
            <section
              id="options"
              aria-labelledby="options-title"
              className="flex scroll-mt-20 flex-col gap-3"
            >
              <h2 id="options-title" className="text-sm font-semibold">
                {chosen ? (
                  <>
                    Chosen: <span className="font-normal">{chosen.label}</span>
                  </>
                ) : (
                  'Choose an option'
                )}
              </h2>
              <ul className="flex flex-wrap gap-2">
                {product.variants.map((variant) => {
                  const selected = chosen?.id === variant.id;
                  const soldOut = variant.stock.state === 'sold_out';
                  return (
                    <li key={variant.id}>
                      <a
                        href={`?v=${variant.id}#options`}
                        aria-current={selected ? 'true' : undefined}
                        className={cn(
                          'inline-flex min-h-11 min-w-12 items-center justify-center px-4 text-sm font-medium ring-1 transition-colors',
                          selected
                            ? 'ring-transparent'
                            : 'ring-black/10 hover:bg-[var(--store-tint)]',
                          soldOut && !selected && 'text-[#9ca3af] line-through',
                        )}
                        style={{
                          borderRadius: 'calc(var(--store-radius) * 0.75)',
                          ...(selected
                            ? {
                                backgroundColor: 'var(--store-primary)',
                                color: 'var(--store-on-primary)',
                              }
                            : {}),
                        }}
                      >
                        {variant.label}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          <div className="flex flex-col gap-3">
            {canAddToCart && chosen ? (
              <>
                <AddToCart variantId={chosen.id} max={Math.min(10, chosen.maxQuantity)} />
                <div className="[&_a]:bg-white [&_a]:text-[#1f8f4e] [&_a]:shadow-none [&_a]:ring-1 [&_a]:ring-black/10 [&_a:hover]:bg-[#f0fdf4]">
                  {order}
                </div>
              </>
            ) : (
              order
            )}
            <ShareButton
              url={productUrl}
              title={product.name}
              text={`${product.name} – ${priceText} at ${store.name}`}
              label="Share with a friend"
              className="min-h-11 rounded-full text-sm text-[#374151] ring-1 ring-black/10 hover:bg-[var(--store-tint)]"
            />
          </div>

          <TrustList store={store} />

          {product.description ? (
            <section aria-labelledby="about" className="flex flex-col gap-2">
              <h2 id="about" className="store-display text-lg">
                About this product
              </h2>
              <p className="leading-relaxed whitespace-pre-line text-[#4b5563]">
                {product.description}
              </p>
            </section>
          ) : null}
        </div>
      </div>

      {related.length > 0 ? (
        <section
          aria-labelledby="related"
          className="mx-auto mt-14 flex w-full max-w-6xl flex-col gap-5 px-4"
        >
          <h2 id="related" className="store-display text-2xl">
            You may also like
          </h2>
          <ProductGrid products={related} eager={0} />
        </section>
      ) : null}

      {/* Phones: the price and the order button stay in reach while scrolling. */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-black/5 bg-white/90 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md md:hidden">
        <div className="flex items-center gap-3">
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-xs text-[#6b7280]">{product.name}</span>
            <span className="font-semibold">{priceText}</span>
          </div>
          <div className="ml-auto shrink-0 [&_a]:min-h-11 [&_a]:px-5 [&_a]:text-sm [&_p]:min-h-11 [&_p]:text-xs">
            {canAddToCart && chosen ? (
              <AddToCart variantId={chosen.id} max={1} compact />
            ) : chosen || product.soldOut ? (
              order
            ) : (
              <a
                href="#options"
                className="inline-flex items-center justify-center rounded-full font-semibold"
                style={{
                  backgroundColor: 'var(--store-primary)',
                  color: 'var(--store-on-primary)',
                }}
              >
                Choose an option
              </a>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

/** "Add to cart": a plain form (works without JavaScript), then the cart page. */
function AddToCart({
  variantId,
  max,
  compact = false,
}: {
  variantId: string;
  max: number;
  compact?: boolean;
}) {
  const button = (
    <button
      type="submit"
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-full font-semibold shadow-sm transition-transform active:scale-[0.98]',
        compact ? 'min-h-11 px-5 text-sm' : 'min-h-12 flex-1 px-6 text-base',
      )}
      style={{ backgroundColor: 'var(--store-primary)', color: 'var(--store-on-primary)' }}
    >
      <ShoppingBag className="size-5" aria-hidden />
      Add to cart
    </button>
  );
  return (
    <form method="post" action="/cart/add" className="flex gap-2">
      <input type="hidden" name="variantId" value={variantId} />
      {compact || max <= 1 ? (
        <input type="hidden" name="quantity" value="1" />
      ) : (
        <select
          name="quantity"
          aria-label="Quantity"
          defaultValue="1"
          className="min-h-12 rounded-full bg-white px-4 font-medium ring-1 ring-black/15"
        >
          {Array.from({ length: max }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              {i + 1}
            </option>
          ))}
        </select>
      )}
      {button}
    </form>
  );
}

/** Other products from the same category (or the newest), up to four. */
async function relatedProducts(businessId: string, productId: string, category: string | null) {
  const same = category ? (await loadStoreProducts(businessId, category, 1)).products : [];
  let picks = same.filter((p) => p.id !== productId);
  if (picks.length < 4) {
    const newest = (await loadStoreProducts(businessId, null, 1)).products;
    for (const p of newest)
      if (p.id !== productId && !picks.some((x) => x.id === p.id)) picks.push(p);
  }
  picks = picks.filter((p) => !p.soldOut).slice(0, 4);
  return picks;
}

function StockPill({ state, label }: { state: StoreVariant['stock']['state']; label: string }) {
  const tone = {
    in_stock: 'bg-[#dcfce7] text-[#166534]',
    low: 'bg-[#fef3c7] text-[#92400e]',
    sold_out: 'bg-[#f3f4f6] text-[#6b7280]',
  }[state];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
        tone,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {label}
    </span>
  );
}

function OrderButton({
  whatsappNumber,
  productName,
  productUrl,
  chosen,
  soldOut,
}: {
  whatsappNumber: string;
  productName: string;
  productUrl: string;
  chosen: StoreVariant | null;
  soldOut: boolean;
}) {
  if (!chosen) {
    if (soldOut) {
      const message = whatsAppRestockMessage({ productName, productUrl });
      return (
        <WhatsAppButton href={whatsAppLink(whatsappNumber, message)}>
          Ask on WhatsApp
        </WhatsAppButton>
      );
    }
    return (
      <p className="flex min-h-12 items-center justify-center rounded-lg border border-dashed px-4 text-sm text-muted-foreground">
        Choose an option above to order
      </p>
    );
  }
  const item = { productName, variantLabel: chosen.label, productUrl };
  if (chosen.stock.state === 'sold_out') {
    return (
      <WhatsAppButton href={whatsAppLink(whatsappNumber, whatsAppRestockMessage(item))}>
        Ask on WhatsApp when it&apos;s back
      </WhatsAppButton>
    );
  }
  return (
    <WhatsAppButton
      href={whatsAppLink(whatsappNumber, whatsAppOrderMessage({ ...item, price: chosen.price }))}
    >
      Order on WhatsApp
    </WhatsAppButton>
  );
}

/**
 * Swipeable photos (CSS scroll-snap, no JavaScript): edge to edge on phones, with small
 * thumbnails that jump to each photo.
 */
function Gallery({
  name,
  photos,
}: {
  name: string;
  photos: { sm: string; md: string; lg: string }[];
}) {
  if (photos.length === 0) {
    return (
      <div className="store-display flex aspect-[4/5] items-center justify-center bg-[var(--store-tint)] text-7xl text-[var(--store-ink)] opacity-40 md:rounded-[var(--store-radius)]">
        {name.slice(0, 1).toUpperCase()}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 md:sticky md:top-20 md:self-start">
      <ul className="store-scroll flex snap-x snap-mandatory overflow-x-auto scroll-smooth md:rounded-[var(--store-radius)]">
        {photos.map((urls, i) => (
          <li key={urls.md} id={`photo-${i + 1}`} className="relative w-full shrink-0 snap-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- pre-sized storage image */}
            <img
              src={urls.md}
              srcSet={`${urls.md} 600w, ${urls.lg} 1200w`}
              sizes="(min-width: 768px) 50vw, 100vw"
              alt={i === 0 ? name : `${name}, photo ${i + 1}`}
              loading={i === 0 ? 'eager' : 'lazy'}
              fetchPriority={i === 0 ? 'high' : undefined}
              decoding="async"
              className="aspect-[4/5] w-full bg-[var(--store-tint)] object-cover"
            />
            {photos.length > 1 ? (
              <span className="absolute right-3 bottom-3 rounded-full bg-black/55 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm">
                {i + 1} / {photos.length}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {photos.length > 1 ? (
        <ul className="flex gap-2 px-4 md:px-0">
          {photos.map((urls, i) => (
            <li key={urls.sm}>
              <a
                href={`#photo-${i + 1}`}
                aria-label={`Photo ${i + 1}`}
                className="block size-14 overflow-hidden ring-1 ring-black/10"
                style={{ borderRadius: 'calc(var(--store-radius) * 0.6)' }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- pre-sized storage image */}
                <img src={urls.sm} alt="" loading="lazy" className="size-full object-cover" />
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
