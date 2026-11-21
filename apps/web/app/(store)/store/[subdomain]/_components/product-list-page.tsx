import type { StoreProductCard } from '@fulcra/core';
import type { ThemeCard } from '@/lib/store-themes';
import { ProductGrid } from './product-grid';

/** A list of products with simple "Previous / More products" links. */
export function ProductListPage({
  title,
  basePath,
  products,
  page,
  hasMore,
  card,
  phoneColumns,
}: {
  card?: ThemeCard;
  phoneColumns?: 2 | 3;
  title: string;
  basePath: string;
  products: StoreProductCard[];
  page: number;
  hasMore: boolean;
}) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-2">
        <nav className="flex items-center gap-1.5 text-sm text-(--store-subtle)">
          <a href="/" className="hover:text-(--store-fg)">
            Home
          </a>
          <span aria-hidden>/</span>
          <span className="text-(--store-fg)">{title}</span>
        </nav>
        <h1 className="store-display text-4xl">{title}</h1>
      </div>
      {products.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-[var(--store-radius)] bg-[var(--store-tint)] px-6 py-14 text-center">
          <h2 className="store-display text-xl">Nothing here yet</h2>
          <p className="text-(--store-muted)">
            Check back soon, or message us on WhatsApp to ask what&apos;s available.
          </p>
        </div>
      ) : (
        <ProductGrid products={products} card={card} phoneColumns={phoneColumns} />
      )}
      {page > 1 || hasMore ? (
        <div className="flex justify-between gap-3">
          {page > 1 ? (
            <a
              href={page === 2 ? basePath : `${basePath}?page=${page - 1}`}
              className="inline-flex min-h-11 items-center rounded-full px-5 text-sm font-medium ring-1 ring-(--store-line) hover:bg-[var(--store-tint)]"
            >
              ← Previous
            </a>
          ) : (
            <span />
          )}
          {hasMore ? (
            <a
              href={`${basePath}?page=${page + 1}`}
              className="inline-flex min-h-11 items-center rounded-full px-5 text-sm font-medium ring-1 ring-(--store-line) hover:bg-[var(--store-tint)]"
            >
              More products →
            </a>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}

/** Reads `?page=` safely. */
export function pageNumber(value: string | string[] | undefined): number {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(n) && n >= 1 && n <= 1000 ? n : 1;
}
