import { APP_NAME } from '@fulcra/config';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { imageUrls } from '@/lib/images';
import { loadStore } from '@/lib/store';
import { dashboardUrl } from '@/lib/urls';

type Props = { children: ReactNode; params: Promise<{ subdomain: string }> };

/** Header and footer for the shop pages (not the receipt, which has its own). */
export default async function ShopLayout({ children, params }: Props) {
  const { subdomain } = await params;
  const store = await loadStore(subdomain);
  if (!store) notFound();
  const logo = store.brand.logo ? imageUrls(store.brand.logo).sm : null;
  return (
    <>
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-3 px-4">
          <a href="/" className="flex min-w-0 items-center gap-2 font-semibold">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- pre-sized storage image
              <img
                src={logo}
                alt=""
                width={32}
                height={32}
                className="size-8 rounded object-contain"
              />
            ) : (
              <span
                className="flex size-8 items-center justify-center rounded text-sm font-bold"
                style={{
                  backgroundColor: 'var(--store-primary)',
                  color: 'var(--store-on-primary)',
                }}
                aria-hidden
              >
                {store.name.slice(0, 1).toUpperCase()}
              </span>
            )}
            <span className="truncate">{store.name}</span>
          </a>
          <a
            href="/products"
            className="ml-auto shrink-0 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            All products
          </a>
        </div>
      </header>
      <div className="flex flex-1 flex-col">{children}</div>
      <footer className="border-t px-4 py-6 text-center text-xs text-muted-foreground">
        © {store.name} · Store by {APP_NAME}
      </footer>
      {store.webChatKey && (
        // The website chat bubble: loads after the page, never blocks it.
        <script async src={dashboardUrl('/widget.js')} data-fulcra={store.webChatKey} />
      )}
    </>
  );
}
