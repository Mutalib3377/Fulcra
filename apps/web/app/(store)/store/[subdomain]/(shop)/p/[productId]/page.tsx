import { formatNaira } from '@fulcra/config';
import {
  storeUrl,
  whatsAppLink,
  whatsAppOrderMessage,
  whatsAppRestockMessage,
  type StoreVariant,
} from '@fulcra/core';
import { cn } from '@fulcra/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { imageUrls } from '@/lib/images';
import { loadStore, loadStoreProduct } from '@/lib/store';
import { shareMetadata } from '../../../_components/share';
import { WhatsAppButton } from '../../../_components/whatsapp-button';

type Props = {
  params: Promise<{ subdomain: string; productId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const STOCK_COLOURS: Record<StoreVariant['stock']['state'], string> = {
  in_stock: 'text-success',
  low: 'text-warning',
  sold_out: 'text-muted-foreground',
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

  return (
    <main className="mx-auto grid w-full max-w-5xl flex-1 gap-6 px-4 py-6 md:grid-cols-2 md:gap-10">
      <Gallery name={product.name} photos={product.photos.map((photo) => imageUrls(photo))} />

      <div className="flex flex-col gap-5">
        <nav className="text-sm text-muted-foreground">
          <a href="/" className="hover:text-foreground">
            Home
          </a>
          {product.category ? (
            <>
              {' / '}
              <a
                href={`/c/${encodeURIComponent(product.category)}`}
                className="hover:text-foreground"
              >
                {product.category}
              </a>
            </>
          ) : null}
        </nav>

        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold text-balance">{product.name}</h1>
          <p className="text-xl font-semibold">
            {!chosen && product.hasPriceRange ? 'From ' : ''}
            {formatNaira(price)}
          </p>
          {product.wholesale ? (
            <p className="text-sm text-muted-foreground">
              Wholesale: {formatNaira(product.wholesale.price)} each when you buy{' '}
              {product.wholesale.minQty} or more
            </p>
          ) : null}
        </div>

        {product.hasOptions ? (
          <section
            id="options"
            aria-labelledby="options-title"
            className="flex scroll-mt-20 flex-col gap-2"
          >
            <h2 id="options-title" className="text-sm font-semibold">
              {chosen ? `Chosen: ${chosen.label}` : 'Choose an option'}
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
                        'inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border px-3 text-sm font-medium',
                        selected ? 'border-2' : 'hover:bg-muted',
                        soldOut && 'text-muted-foreground line-through',
                      )}
                      style={selected ? { borderColor: 'var(--store-primary)' } : undefined}
                    >
                      {variant.label}
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {chosen ? (
          <p className={cn('text-sm font-semibold', STOCK_COLOURS[chosen.stock.state])}>
            {chosen.stock.label}
          </p>
        ) : product.soldOut ? (
          <p className="text-sm font-semibold text-muted-foreground">Sold out</p>
        ) : null}

        <OrderButton
          whatsappNumber={store.whatsappNumber}
          productName={product.name}
          productUrl={productUrl}
          chosen={chosen}
          soldOut={product.soldOut}
        />

        {product.description ? (
          <section aria-labelledby="about" className="flex flex-col gap-2 border-t pt-5">
            <h2 id="about" className="text-sm font-semibold">
              About this product
            </h2>
            <p className="text-sm leading-relaxed whitespace-pre-line text-muted-foreground">
              {product.description}
            </p>
          </section>
        ) : null}
      </div>
    </main>
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

/** Swipeable photos (CSS scroll-snap, no JavaScript). */
function Gallery({
  name,
  photos,
}: {
  name: string;
  photos: { sm: string; md: string; lg: string }[];
}) {
  if (photos.length === 0) {
    return (
      <div className="flex aspect-square items-center justify-center rounded-lg bg-muted text-5xl font-bold text-muted-foreground/40">
        {name.slice(0, 1).toUpperCase()}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex snap-x snap-mandatory overflow-x-auto rounded-lg [scrollbar-width:none]">
        {photos.map((urls, i) => (
          <li key={urls.md} id={`photo-${i + 1}`} className="w-full shrink-0 snap-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- pre-sized storage image */}
            <img
              src={urls.md}
              srcSet={`${urls.md} 600w, ${urls.lg} 1200w`}
              sizes="(min-width: 768px) 50vw, 100vw"
              alt={i === 0 ? name : `${name}, photo ${i + 1}`}
              loading={i === 0 ? 'eager' : 'lazy'}
              fetchPriority={i === 0 ? 'high' : undefined}
              decoding="async"
              className="aspect-square w-full bg-muted object-cover"
            />
          </li>
        ))}
      </ul>
      {photos.length > 1 ? (
        <p className="text-center text-xs text-muted-foreground">
          {photos.length} photos · swipe to see more
        </p>
      ) : null}
    </div>
  );
}
