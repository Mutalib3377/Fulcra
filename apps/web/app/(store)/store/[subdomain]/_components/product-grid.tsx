import { formatNaira } from '@fulcra/config';
import type { StoreProductCard } from '@fulcra/core';
import { imageUrls } from '@/lib/images';

/** Product cards, two per row on phones. The first row loads eagerly, the rest lazily. */
export function ProductGrid({ products }: { products: StoreProductCard[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {products.map((product, i) => {
        const urls = product.photo ? imageUrls(product.photo) : null;
        return (
          <li key={product.id}>
            <a href={`/p/${product.id}`} className="group flex flex-col gap-2">
              <div className="relative aspect-square overflow-hidden rounded-lg bg-muted">
                {urls ? (
                  // eslint-disable-next-line @next/next/no-img-element -- pre-sized storage image
                  <img
                    src={urls.md}
                    srcSet={`${urls.sm} 200w, ${urls.md} 600w`}
                    sizes="(min-width: 768px) 25vw, (min-width: 640px) 33vw, 50vw"
                    alt={product.name}
                    loading={i < 4 ? 'eager' : 'lazy'}
                    decoding="async"
                    className="size-full object-cover transition-transform group-hover:scale-[1.02]"
                  />
                ) : (
                  <div className="flex size-full items-center justify-center text-3xl font-bold text-muted-foreground/40">
                    {product.name.slice(0, 1).toUpperCase()}
                  </div>
                )}
                {product.soldOut ? (
                  <span className="absolute top-2 left-2 rounded bg-background/90 px-2 py-0.5 text-xs font-semibold">
                    Sold out
                  </span>
                ) : null}
              </div>
              <div className="flex flex-col">
                <span className="line-clamp-2 text-sm font-medium">{product.name}</span>
                <span className="text-sm font-semibold">
                  {product.hasPriceRange ? 'From ' : ''}
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
