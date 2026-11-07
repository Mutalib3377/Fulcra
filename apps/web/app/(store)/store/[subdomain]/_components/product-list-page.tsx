import type { StoreProductCard } from '@fulcra/core';
import { EmptyState } from '@fulcra/ui';
import { ProductGrid } from './product-grid';

/** A list of products with simple "Previous / More products" links. */
export function ProductListPage({
  title,
  basePath,
  products,
  page,
  hasMore,
}: {
  title: string;
  basePath: string;
  products: StoreProductCard[];
  page: number;
  hasMore: boolean;
}) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-4 py-6">
      <nav className="text-sm text-muted-foreground">
        <a href="/" className="hover:text-foreground">
          Home
        </a>{' '}
        / <span className="text-foreground">{title}</span>
      </nav>
      <h1 className="text-2xl font-bold">{title}</h1>
      {products.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          description="Check back soon, or message us on WhatsApp to ask what's available."
        />
      ) : (
        <ProductGrid products={products} />
      )}
      {page > 1 || hasMore ? (
        <div className="flex justify-between gap-3">
          {page > 1 ? (
            <a
              href={page === 2 ? basePath : `${basePath}?page=${page - 1}`}
              className="rounded-md border px-4 py-2 text-sm font-medium"
            >
              ← Previous
            </a>
          ) : (
            <span />
          )}
          {hasMore ? (
            <a
              href={`${basePath}?page=${page + 1}`}
              className="rounded-md border px-4 py-2 text-sm font-medium"
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
