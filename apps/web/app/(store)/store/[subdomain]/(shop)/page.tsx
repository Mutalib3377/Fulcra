import { whatsAppHelloMessage, whatsAppLink } from '@fulcra/core';
import { ArrowRight } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { imageUrls } from '@/lib/images';
import { loadStore, loadStoreHome } from '@/lib/store';
import { storeThemeFor } from '@/lib/store-theme-server';
import { ProductGrid } from '../_components/product-grid';
import { shareMetadata } from '../_components/share';
import { StoreHero } from '../_components/store-hero';
import { trustItems } from '../_components/trust';
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
      image: home.featured.find((p) => p.photo)?.photo ?? store.brand.logo ?? null,
    }),
  };
}

export default async function StoreHome({ params }: Props) {
  const { subdomain } = await params;
  const store = await loadStore(subdomain);
  if (!store) notFound();
  const home = await loadStoreHome(store.businessId);
  const logo = store.brand.logo ? imageUrls(store.brand.logo).md : null;
  const hello = whatsAppLink(store.whatsappNumber, whatsAppHelloMessage(store.name));
  const { option } = await storeThemeFor(store);
  const heroPhotos = home.featured
    .filter((p) => p.photo && !p.soldOut)
    .slice(0, 4)
    .map((p) => ({ id: p.id, name: p.name, src: imageUrls(p.photo!).md }));
  const trust = trustItems(store);

  return (
    <main className="flex flex-1 flex-col">
      <StoreHero
        variant={option.hero}
        name={store.name}
        description={store.brand.description}
        logo={logo}
        productCount={home.productCount}
        deliveryAvailable={store.trust.deliveryAreaCount > 0}
        webChat={Boolean(store.webChatKey)}
        hello={hello}
        photos={heroPhotos}
      />

      {/* What the shop promises, from its real setup. */}
      <section aria-label="Why shop here" className="border-b border-(--store-line)">
        <ul className="store-scroll mx-auto flex w-full max-w-6xl snap-x scroll-px-4 gap-3 overflow-x-auto px-4 py-4 md:grid md:grid-cols-3 md:overflow-visible">
          {trust.map(({ key, icon: Icon, title, text }) => (
            <li key={key} className="flex min-w-[15rem] snap-start items-center gap-3 md:min-w-0">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--store-tint-strong)] text-[var(--store-ink)]">
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="flex flex-col">
                <span className="text-sm font-semibold">{title}</span>
                <span className="text-xs text-(--store-subtle)">{text}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <div
        id="shop"
        className="mx-auto flex w-full max-w-6xl scroll-mt-16 flex-col gap-12 px-4 py-10"
      >
        {home.productCount === 0 ? (
          <div className="flex flex-col items-center gap-4 rounded-[var(--store-radius)] bg-[var(--store-tint)] px-6 py-14 text-center">
            <h2 className="store-display text-2xl">New products coming soon</h2>
            <p className="max-w-sm text-(--store-muted)">
              Message us on WhatsApp to ask what&apos;s available today.
            </p>
            <WhatsAppButton href={hello}>Ask on WhatsApp</WhatsAppButton>
          </div>
        ) : (
          <>
            {home.categories.length > 0 ? (
              <section aria-labelledby="categories" className="-mx-4 flex flex-col gap-4">
                <h2 id="categories" className="store-display px-4 text-2xl">
                  Shop by category
                </h2>
                <ul className="store-scroll flex snap-x scroll-px-4 gap-2.5 overflow-x-auto px-4 pb-1">
                  {home.categories.map((category) => (
                    <li key={category.name} className="snap-start">
                      <a
                        href={`/c/${encodeURIComponent(category.name)}`}
                        aria-label={`${category.name}, ${category.productCount} ${category.productCount === 1 ? 'product' : 'products'}`}
                        className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[var(--store-tint)] px-4 text-sm font-medium whitespace-nowrap ring-1 ring-(--store-line) transition-colors hover:bg-[var(--store-tint-strong)]"
                      >
                        {category.name}
                        <span className="rounded-full bg-(--store-surface) px-1.5 text-xs text-(--store-subtle)">
                          {category.productCount}
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section aria-labelledby="featured" className="flex flex-col gap-5">
              <div className="flex items-end justify-between gap-3">
                <h2 id="featured" className="store-display text-2xl">
                  {home.featuredIsPicked ? 'Featured' : 'New in'}
                </h2>
                {home.productCount > home.featured.length ? (
                  <a
                    href="/products"
                    className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--store-ink)]"
                  >
                    See all <ArrowRight className="size-4" aria-hidden />
                  </a>
                ) : null}
              </div>
              <ProductGrid
                products={home.featured}
                card={option.card}
                phoneColumns={option.phoneColumns}
              />
              {home.productCount > home.featured.length ? (
                <a
                  href="/products"
                  className="inline-flex min-h-12 items-center justify-center gap-2 self-center rounded-full px-7 font-semibold shadow-sm"
                  style={{
                    backgroundColor: 'var(--store-primary)',
                    color: 'var(--store-on-primary)',
                  }}
                >
                  See all {home.productCount} products <ArrowRight className="size-4" aria-hidden />
                </a>
              ) : null}
            </section>

            <HowToOrder hello={hello} securePayments={store.trust.securePayments} />
          </>
        )}
      </div>
    </main>
  );
}

function HowToOrder({ hello, securePayments }: { hello: string; securePayments: boolean }) {
  const steps = [
    { title: 'Pick what you love', text: 'Browse the products and choose your size or colour.' },
    {
      title: 'Order on WhatsApp',
      text: 'Tap the order button and send the message. We reply fast.',
    },
    {
      title: 'Pay and receive',
      text: securePayments
        ? 'Pay securely, get a receipt, and we deliver or you pick up.'
        : 'Pay as agreed in the chat, and we deliver or you pick up.',
    },
  ];
  return (
    <section
      aria-labelledby="how"
      className="flex flex-col gap-6 rounded-[calc(var(--store-radius)+0.5rem)] bg-[var(--store-tint)] p-6 md:p-10"
    >
      <h2 id="how" className="store-display text-2xl">
        How to order
      </h2>
      <ol className="grid gap-5 md:grid-cols-3">
        {steps.map((step, i) => (
          <li key={step.title} className="flex gap-4">
            <span
              className="store-display flex size-10 shrink-0 items-center justify-center rounded-full text-lg"
              style={{ backgroundColor: 'var(--store-primary)', color: 'var(--store-on-primary)' }}
            >
              {i + 1}
            </span>
            <span className="flex flex-col gap-1">
              <span className="font-semibold">{step.title}</span>
              <span className="text-sm text-(--store-muted)">{step.text}</span>
            </span>
          </li>
        ))}
      </ol>
      <WhatsAppButton href={hello} className="self-start">
        Start an order
      </WhatsAppButton>
    </section>
  );
}
