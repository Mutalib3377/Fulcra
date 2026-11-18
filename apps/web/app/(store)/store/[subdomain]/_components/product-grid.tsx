import { formatNaira } from '@fulcra/config';
import type { StoreProductCard } from '@fulcra/core';
import { imageUrls } from '@/lib/images';

/**
 * Product cards, two per row on phones. Portrait photos (they flatter clothes, bags and food
 * alike); the first row loads eagerly, the rest lazily.
 */
export function ProductGrid({
  products,
  eager = 4,
}: {
  products: StoreProductCard[];
  eager?: number;
}) {
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 md:grid-cols-4 md:gap-x-5">
      {products.map((product, i) => {
        const urls = product.photo ? imageUrls(product.photo) : null;
        return (
          <li key={product.id}>
            <a href={`/p/${product.id}`} className="group flex flex-col gap-2.5">
              <div
                className="relative aspect-[4/5] overflow-hidden bg-[var(--store-tint)]"
                style={{ borderRadius: 'var(--store-radius)' }}
              >
                {urls ? (
                  // eslint-disable-next-line @next/next/no-img-element -- pre-sized storage image
                  <img
                    src={urls.md}
                    srcSet={`${urls.sm} 200w, ${urls.md} 600w`}
                    sizes="(min-width: 768px) 25vw, (min-width: 640px) 33vw, 50vw"
                    alt={product.name}
                    loading={i < eager ? 'eager' : 'lazy'}
                    decoding="async"
                    className={`size-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04] ${product.soldOut ? 'opacity-60 grayscale-[40%]' : ''}`}
                  />
                ) : (
                  <div className="store-display flex size-full items-center justify-center text-5xl text-[var(--store-ink)] opacity-30">
                    {product.name.slice(0, 1).toUpperCase()}
                  </div>
                )}
                {product.soldOut ? (
                  <span className="absolute top-2.5 left-2.5 rounded-full bg-[#111827]/85 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-white uppercase">
                    Sold out
                  </span>
                ) : product.fewLeft !== null ? (
                  <span
                    className="absolute top-2.5 left-2.5 rounded-full px-2.5 py-1 text-[11px] font-semibold shadow-sm"
                    style={{
                      backgroundColor: 'var(--store-accent)',
                      color: 'var(--store-on-accent)',
                    }}
                  >
                    Only {product.fewLeft} left
                  </span>
                ) : null}
              </div>
              <div className="flex flex-col gap-0.5 px-0.5">
                <span className="line-clamp-2 text-[0.9375rem] leading-snug text-[#374151]">
                  {product.name}
                </span>
                <span className="text-base font-semibold tracking-tight">
                  {product.hasPriceRange ? (
                    <span className="text-sm font-normal text-[#6b7280]">From </span>
                  ) : null}
                  {formatNaira(product.price)}
                </span>
              </div>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
