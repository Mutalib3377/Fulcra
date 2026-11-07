import { EmptyState } from '@fulcra/ui';

/** A product or page inside a store that does not exist (or is hidden). */
export default function ShopNotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-16">
      <EmptyState
        title="We couldn't find that"
        description="This product may be sold out for good or no longer listed."
      />
      <a
        href="/products"
        className="rounded-md px-4 py-2 text-sm font-semibold"
        style={{ backgroundColor: 'var(--store-primary)', color: 'var(--store-on-primary)' }}
      >
        See all products
      </a>
    </main>
  );
}
