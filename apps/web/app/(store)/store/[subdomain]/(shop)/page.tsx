import { whatsAppHelloMessage, whatsAppLink } from '@fulcra/core';
import { ArrowRight, Sparkles } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { imageUrls } from '@/lib/images';
import { loadStore, loadStoreHome } from '@/lib/store';
import { ProductGrid } from '../_components/product-grid';
import { shareMetadata } from '../_components/share';
import { StoreLogo } from '../_components/store-logo';
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
  const collage = home.featured.filter((p) => p.photo && !p.soldOut).slice(0, 3);
  const trust = trustItems(store);

  return (
    <main className="flex flex-1 flex-col">
      {/* Hero: the brand's colours, the shop's own photos, one clear way to buy. */}
      <section className="store-hero relative isolate overflow-hidden text-[var(--store-on-primary)]">
        <div className="store-dots pointer-events-none absolute inset-0 -z-10" aria-hidden />
        <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 pt-10 pb-12 md:grid-cols-[1.1fr_1fr] md:pt-16 md:pb-20">
          <div className="flex flex-col items-start gap-5">
            {logo ? (
              <StoreLogo name={store.name} src={logo} size={64} className="shadow-lg" />
            ) : null}
            {home.productCount > 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium backdrop-blur-sm ring-1 ring-white/20">
                <Sparkles className="size-3.5" aria-hidden />
                {home.productCount} {home.productCount === 1 ? 'product' : 'products'}
                {store.trust.deliveryAreaCount > 0 ? ' · Delivery available' : ''}
              </span>
            ) : null}
            <h1 className="store-display text-[2.6rem] leading-[1.04] text-balance sm:text-5xl md:text-6xl">
              {store.name}
            </h1>
            {store.brand.description ? (
              <p className="max-w-lg text-[1.0625rem] leading-relaxed whitespace-pre-line opacity-90">
                {store.brand.description}
              </p>
            ) : null}
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <WhatsAppButton href={hello} className="w-full sm:w-auto">
                Order on WhatsApp
              </WhatsAppButton>
              {store.webChatKey ? (
                // Opens the chat bubble; without JavaScript it falls back to WhatsApp.
                <a
                  href={hello}
                  data-fulcra-open
                  className="inline-flex min-h-12 items-center justify-center rounded-full bg-white/15 px-6 font-semibold ring-1 ring-white/30 backdrop-blur-sm hover:bg-white/25"
                >
                  Chat to buy
                </a>
              ) : home.productCount > 0 ? (
                <a
                  href="#shop"
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-white/15 px-6 font-semibold ring-1 ring-white/30 backdrop-blur-sm hover:bg-white/25"
                >
                  Browse products <ArrowRight className="size-4" aria-hidden />
                </a>
              ) : null}
            </div>
          </div>

          {collage.length > 0 ? <Collage products={collage} /> : null}
        </div>
      </section>

      {/* What the shop promises, from its real setup. */}
      <section aria-label="Why shop here" className="border-b border-black/5">
        <ul className="store-scroll mx-auto flex w-full max-w-6xl snap-x scroll-px-4 gap-3 overflow-x-auto px-4 py-4 md:grid md:grid-cols-3 md:overflow-visible">
          {trust.map(({ key, icon: Icon, title, text }) => (
            <li key={key} className="flex min-w-[15rem] snap-start items-center gap-3 md:min-w-0">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--store-tint-strong)] text-[var(--store-ink)]">
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="flex flex-col">
                <span className="text-sm font-semibold">{title}</span>
                <span className="text-xs text-[#6b7280]">{text}</span>
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
            <p className="max-w-sm text-[#4b5563]">
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
                        className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[var(--store-tint)] px-4 text-sm font-medium whitespace-nowrap ring-1 ring-black/5 transition-colors hover:bg-[var(--store-tint-strong)]"
                      >
                        {category.name}
                        <span className="rounded-full bg-white px-1.5 text-xs text-[#6b7280]">
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
              <ProductGrid products={home.featured} />
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

/** Up to three product photos fanned out like prints on a table. */
function Collage({
  products,
}: {
  products: {
    id: string;
    name: string;
    photo: { path: string; width: number; height: number } | null;
  }[];
}) {
  const placements = [
    'left-1/2 top-2 z-20 w-[52%] -translate-x-1/2 rotate-[-2deg]',
    'left-0 top-10 z-10 w-[44%] rotate-[-9deg]',
    'right-0 top-12 z-10 w-[44%] rotate-[8deg]',
  ];
  const ordered = products.length === 1 ? [products[0]!] : products;
  return (
    <div className="relative mx-auto -mb-4 h-[16.5rem] w-full max-w-md sm:h-[23rem]" aria-hidden>
      {ordered.map((p, i) => (
        <a
          key={p.id}
          href={`/p/${p.id}`}
          tabIndex={-1}
          className={`absolute aspect-[4/5] overflow-hidden bg-white p-1.5 shadow-[0_20px_40px_-12px_rgb(0_0_0/0.45)] transition-transform duration-500 hover:rotate-0 ${products.length === 1 ? 'left-1/2 top-2 z-20 w-[62%] -translate-x-1/2 rotate-[-3deg]' : placements[i]}`}
          style={{ borderRadius: 'calc(var(--store-radius) + 0.25rem)' }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- pre-sized storage image */}
          <img
            src={imageUrls(p.photo!).md}
            alt=""
            loading={i === 0 ? 'eager' : 'lazy'}
            fetchPriority={i === 0 ? 'high' : undefined}
            decoding="async"
            className="size-full object-cover"
            style={{ borderRadius: 'var(--store-radius)' }}
          />
        </a>
      ))}
    </div>
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
              <span className="text-sm text-[#4b5563]">{step.text}</span>
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
