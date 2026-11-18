import { APP_NAME } from '@fulcra/config';
import { whatsAppHelloMessage, whatsAppLink } from '@fulcra/core';
import { ArrowUpRight, Sparkles } from 'lucide-react';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
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
  const home = storeUrl(store.subdomain);
  const hello = whatsAppLink(store.whatsappNumber, whatsAppHelloMessage(store.name));
  // Where shoppers who like the store can make their own (counted per store).
  const ownStore = marketingUrl(
    `/?ref=store&utm_source=store&utm_medium=footer&utm_campaign=${encodeURIComponent(store.subdomain)}`,
  );
  return (
    <>
      <header className="sticky top-0 z-20 border-b border-black/5 bg-white/85 backdrop-blur-md supports-[backdrop-filter]:bg-white/70">
        <div className="mx-auto flex h-15 w-full max-w-6xl items-center gap-3 px-4">
          <a href="/" className="flex min-w-0 items-center gap-2.5">
            <StoreLogo name={store.name} src={logo} size={36} />
            <span className="store-display truncate text-[1.0625rem]">{store.name}</span>
          </a>
          <nav className="ml-auto flex shrink-0 items-center gap-1">
            <a
              href="/products"
              className="hidden rounded-full px-3 py-2 text-sm font-medium text-[#374151] hover:bg-[var(--store-tint)] sm:inline-flex"
            >
              All products
            </a>
            <ShareButton
              url={home}
              title={store.name}
              text={`Check out ${store.name}`}
              label="Share this store"
              iconOnly
              className="size-10 rounded-full text-[#374151] hover:bg-[var(--store-tint)]"
            />
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
                <p className="line-clamp-3 text-sm text-[#4b5563]">{store.brand.description}</p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href={hello}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-medium shadow-sm ring-1 ring-black/5"
              >
                <WhatsAppIcon className="size-4 text-[#1f8f4e]" /> Chat with us
              </a>
              <ShareButton
                url={home}
                title={store.name}
                text={`Check out ${store.name}`}
                label="Share this store"
                className="h-10 rounded-full bg-white px-4 text-sm shadow-sm ring-1 ring-black/5"
              />
            </div>
          </div>

          <a
            href={ownStore}
            className="group flex items-center justify-between gap-4 rounded-2xl bg-[#111827] p-4 text-white sm:p-5"
          >
            <span className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/10">
                <Sparkles className="size-4.5" aria-hidden />
              </span>
              <span className="flex flex-col">
                <span className="text-sm font-semibold">Sell on WhatsApp like {store.name}</span>
                <span className="text-xs text-white/70">
                  Get your own free store and AI sales assistant with {APP_NAME}
                </span>
              </span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-[#111827] transition-transform group-hover:translate-x-0.5">
              Start free <ArrowUpRight className="size-3.5" aria-hidden />
            </span>
          </a>

          <p className="text-center text-xs text-[#6b7280]">
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
