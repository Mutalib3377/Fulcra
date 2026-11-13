import { whatsAppHelloMessage, whatsAppLink } from '@fulcra/core';
import { EmptyState } from '@fulcra/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { imageUrls } from '@/lib/images';
import { loadStore, loadStoreHome } from '@/lib/store';
import { ProductGrid } from '../_components/product-grid';
import { shareMetadata } from '../_components/share';
import { WhatsAppButton } from '../_components/whatsapp-button';

type Props = { params: Promise<{ subdomain: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { subdomain } = await params;
  const store = await loadStore(subdomain);
  if (!store) return {};
  const home = await loadStoreHome(store.businessId);
  return {
    title: { absolute: store.name },
    ...shareMetadata(store, {
      path: '/',
      title: store.name,
      description: store.brand.description || `Shop ${store.name} and order on WhatsApp.`,
      image: store.brand.logo ?? home.featured.find((p) => p.photo)?.photo ?? null,
    }),
  };
}

export default async function StoreHome({ params }: Props) {
  const { subdomain } = await params;
  const store = await loadStore(subdomain);
  if (!store) notFound();
  const home = await loadStoreHome(store.businessId);
  const logo = store.brand.logo ? imageUrls(store.brand.logo).md : null;

  return (
    <main className="flex flex-1 flex-col">
      <section
        className="px-4 py-10"
        style={{ backgroundColor: 'var(--store-primary)', color: 'var(--store-on-primary)' }}
      >
        <div className="mx-auto flex w-full max-w-5xl flex-col items-start gap-4">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- pre-sized storage image
            <img
              src={logo}
              alt=""
              width={72}
              height={72}
              className="size-18 rounded-lg bg-white object-contain p-1"
            />
          ) : null}
          <h1 className="text-3xl font-bold text-balance">{store.name}</h1>
          {store.brand.description ? (
            <p className="max-w-xl text-base opacity-90 whitespace-pre-line">
              {store.brand.description}
            </p>
          ) : null}
          <WhatsAppButton
            href={whatsAppLink(store.whatsappNumber, whatsAppHelloMessage(store.name))}
          >
            Order on WhatsApp
          </WhatsAppButton>
          {store.webChatKey ? (
            // Opens the chat bubble; without JavaScript it falls back to WhatsApp.
            <a
              href={whatsAppLink(store.whatsappNumber, whatsAppHelloMessage(store.name))}
              data-fulcra-open
              className="inline-flex h-11 items-center justify-center rounded-md border border-current px-5 font-medium"
            >
              Chat to buy
            </a>
          ) : null}
        </div>
      </section>

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-8">
        {home.productCount === 0 ? (
          <EmptyState
            title="New products coming soon"
            description="Message us on WhatsApp to ask what's available."
          />
        ) : (
          <>
            {home.categories.length > 0 ? (
              <section aria-labelledby="categories" className="flex flex-col gap-3">
                <h2 id="categories" className="text-lg font-semibold">
                  Shop by category
                </h2>
                <ul className="flex flex-wrap gap-2">
                  {home.categories.map((category) => (
                    <li key={category.name}>
                      <a
                        href={`/c/${encodeURIComponent(category.name)}`}
                        aria-label={`${category.name}, ${category.productCount} ${category.productCount === 1 ? 'product' : 'products'}`}
                        className="inline-flex min-h-10 items-center gap-1.5 rounded-full border px-4 text-sm font-medium hover:bg-muted"
                      >
                        {category.name}
                        <span className="text-muted-foreground">{category.productCount}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section aria-labelledby="featured" className="flex flex-col gap-4">
              <h2 id="featured" className="text-lg font-semibold">
                {home.featuredIsPicked ? 'Featured' : 'New in'}
              </h2>
              <ProductGrid products={home.featured} />
              {home.productCount > home.featured.length ? (
                <a
                  href="/products"
                  className="self-center rounded-md px-5 py-2.5 text-sm font-semibold"
                  style={{
                    backgroundColor: 'var(--store-accent)',
                    color: 'var(--store-on-accent)',
                  }}
                >
                  See all {home.productCount} products
                </a>
              ) : null}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
