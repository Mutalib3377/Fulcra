import { APP_NAME } from '@fulcra/config';
import { whatsAppHelloMessage, whatsAppLink } from '@fulcra/core';
import { cartCount } from '@fulcra/core/rules';
import { ArrowUpRight, ShoppingBag, Sparkles } from 'lucide-react';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { readCart } from '@/lib/cart';
import { storeThemeFor } from '@/lib/store-theme-server';
import { imageUrls } from '@/lib/images';
import { loadStore } from '@/lib/store';
import { dashboardUrl, marketingUrl, storeUrl } from '@/lib/urls';
import { ShareButton } from '../_components/share-button';
import { StoreLogo } from '../_components/store-logo';
import { WhatsAppIcon } from '../_components/whatsapp-button';

type Props = { children: ReactNode; params: Promise<{ subdomain: string }> };

/** Header and footer for the shop pages (not the receipt, which has its own). */
export default async function ShopLayout({ children, params }: Props) {
  const { subdomain } = await params;
  const store = await loadStore(subdomain);
  if (!store) notFound();
  const logo = store.brand.logo ? imageUrls(store.brand.logo).sm : null;
  const count = cartCount(await readCart());
  const home = storeUrl(store.subdomain);
  const hello = whatsAppLink(store.whatsappNumber, whatsAppHelloMessage(store.name));
  // Where shoppers who like the store can make their own (counted per store).
  const ownStore = marketingUrl(
    `/?ref=store&utm_source=store&utm_medium=footer&utm_campaign=${encodeURIComponent(store.subdomain)}`,
  );
  const { option, preview } = await storeThemeFor(store);
  return (
    <>
      {preview ? (
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-[#111827] px-4 py-2 text-center text-xs text-white">
          <span>
            Previewing the <strong>{option.label}</strong> theme. Only you can see this.
          </span>
          <a href="/preview-theme/off" className="font-semibold underline underline-offset-2">
            Back to my saved theme
          </a>
        </div>
      ) : null}
      <header className="sticky top-0 z-20 border-b border-(--store-line) bg-(--store-bg)/85 backdrop-blur-md supports-[backdrop-filter]:bg-(--store-bg)/70">
        <div className="mx-auto flex h-15 w-full max-w-6xl items-center gap-3 px-4">
          <a href="/" className="flex min-w-0 items-center gap-2.5">
            <StoreLogo name={store.name} src={logo} size={36} />
            <span className="store-display truncate text-[1.0625rem]">{store.name}</span>
          </a>
          <nav className="ml-auto flex shrink-0 items-center gap-1">
            <a
              href="/products"
              className="hidden rounded-full px-3 py-2 text-sm font-medium text-(--store-muted) hover:bg-[var(--store-tint)] sm:inline-flex"
            >
              All products
            </a>
            <ShareButton
              url={home}
              title={store.name}
              text={`Check out ${store.name}`}
              label="Share this store"
              iconOnly
              className="size-10 rounded-full text-(--store-muted) hover:bg-[var(--store-tint)]"
            />
            {store.checkout || count > 0 ? (
              <a
                href="/cart"
                aria-label={count > 0 ? `Cart, ${count} ${count === 1 ? 'item' : 'items'}` : 'Cart'}
                className="relative inline-flex size-10 items-center justify-center rounded-full text-(--store-muted) hover:bg-[var(--store-tint)]"
              >
                <ShoppingBag className="size-5" aria-hidden />
                {count > 0 ? (
                  <span
                    className="absolute top-0.5 right-0.5 flex min-w-4.5 items-center justify-center rounded-full px-1 text-[10px] leading-4.5 font-semibold"
                    style={{
                      backgroundColor: 'var(--store-primary)',
                      color: 'var(--store-on-primary)',
                    }}
                  >
                    {count > 99 ? '99+' : count}
                  </span>
                ) : null}
              </a>
            ) : null}
            <a
              href={hello}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Message ${store.name} on WhatsApp`}
              className="inline-flex size-10 items-center justify-center rounded-full text-[#1f8f4e] hover:bg-[#1f8f4e]/10"
            >
              <WhatsAppIcon className="size-5" />
            </a>
          </nav>
        </div>
      </header>

      <div className="flex flex-1 flex-col">{children}</div>

      <footer className="mt-12 bg-[var(--store-tint)]">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 pt-10 pb-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex max-w-sm flex-col gap-3">
              <a href="/" className="flex items-center gap-2.5">
                <StoreLogo name={store.name} src={logo} size={40} />
                <span className="store-display text-lg">{store.name}</span>
              </a>
              {store.brand.description ? (
                <p className="line-clamp-3 text-sm text-(--store-muted)">
                  {store.brand.description}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href={hello}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 items-center gap-2 rounded-full bg-(--store-surface) px-4 text-sm font-medium shadow-sm ring-1 ring-(--store-line)"
              >
                <WhatsAppIcon className="size-4 text-[#1f8f4e]" /> Chat with us
              </a>
              <ShareButton
                url={home}
                title={store.name}
                text={`Check out ${store.name}`}
                label="Share this store"
                className="h-10 rounded-full bg-(--store-surface) px-4 text-sm shadow-sm ring-1 ring-(--store-line)"
              />
            </div>
          </div>

          <a
            href={ownStore}
            className="group flex items-center justify-between gap-4 rounded-2xl bg-(--store-fg) p-4 text-(--store-bg) sm:p-5"
          >
            <span className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/10">
                <Sparkles className="size-4.5" aria-hidden />
              </span>
              <span className="flex flex-col">
                <span className="text-sm font-semibold">Sell on WhatsApp like {store.name}</span>
                <span className="text-xs opacity-70">
                  Get your own free store and AI sales assistant with {APP_NAME}
                </span>
              </span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-(--store-surface) px-3 py-1.5 text-xs font-semibold text-(--store-fg) transition-transform group-hover:translate-x-0.5">
              Start free <ArrowUpRight className="size-3.5" aria-hidden />
            </span>
          </a>

          <p className="text-center text-xs text-(--store-subtle)">
            © {new Date().getFullYear()} {store.name} · Powered by {APP_NAME}
          </p>
        </div>
      </footer>
      {store.webChatKey && (
        // The website chat bubble: loads after the page, never blocks it.
        <script async src={dashboardUrl('/widget.js')} data-fulcra={store.webChatKey} />
      )}
    </>
  );
}
