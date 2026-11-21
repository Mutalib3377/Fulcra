import { formatNaira } from '@fulcra/config';
import type { StoreProductCard } from '@fulcra/core';
import { cn } from '@fulcra/ui';
import { imageUrls } from '@/lib/images';
import type { ThemeCard } from '@/lib/store-themes';

/** Card shape per theme (T1): photo proportions, frame and text layout. */
const CARD: Record<
  ThemeCard,
  { aspect: string; frame: string; image: string; text: string; name: string; price: string }
> = {
  portrait: {
    aspect: 'aspect-[4/5]',
    frame: 'flex flex-col gap-2.5',
    image: '',
    text: 'flex flex-col gap-0.5 px-0.5',
    name: 'line-clamp-2 text-[0.9375rem] leading-snug text-(--store-muted)',
    price: 'text-base font-semibold tracking-tight',
  },
  square: {
    aspect: 'aspect-square',
    frame: 'flex flex-col gap-3',
    image: '',
    text: 'flex flex-col gap-1',
    name: 'line-clamp-2 text-sm leading-snug',
    price: 'text-sm text-(--store-muted)',
  },
  tall: {
    aspect: 'aspect-[3/4]',
    frame: 'flex flex-col gap-3',
    image: '',
    text: 'flex flex-col items-center gap-1 text-center',
    name: 'store-display line-clamp-2 text-[1.0625rem] leading-snug',
    price: 'text-sm tracking-wide text-(--store-muted)',
  },
  framed: {
    aspect: 'aspect-square',
    frame:
      'flex flex-col gap-3 bg-(--store-surface) p-2 ring-1 ring-(--store-line) transition-colors group-hover:ring-(--store-line-strong) rounded-[calc(var(--store-radius)+0.25rem)]',
    image: '',
    text: 'flex flex-col gap-1 px-1.5 pb-1.5',
    name: 'line-clamp-2 text-xs font-semibold tracking-wide uppercase',
    price: 'text-base font-bold text-(--store-ink)',
  },
  compact: {
    aspect: 'aspect-square',
    frame:
      'flex h-full flex-col gap-2 bg-(--store-surface) p-1.5 shadow-[0_1px_2px_rgb(0_0_0/0.05)] rounded-[calc(var(--store-radius)+0.125rem)]',
    image: '',
    text: 'flex flex-col gap-0.5 px-1 pb-1',
    name: 'line-clamp-2 text-[0.8125rem] leading-snug',
    price: 'text-sm font-bold',
  },
  soft: {
    aspect: 'aspect-square',
    frame:
      'flex flex-col gap-3 bg-(--store-tint) p-2.5 transition-transform group-hover:-translate-y-0.5 rounded-[calc(var(--store-radius)+0.5rem)]',
    image: '',
    text: 'flex flex-col items-center gap-1 pb-1.5 text-center',
    name: 'line-clamp-2 text-sm font-semibold leading-snug',
    price: 'text-sm font-bold text-(--store-ink)',
  },
};

/**
 * Product cards. The theme picks the shape and how many sit side by side on a phone. The first
 * row loads eagerly, the rest lazily.
 */
export function ProductGrid({
  products,
  eager = 4,
  card = 'portrait',
  phoneColumns = 2,
}: {
  products: StoreProductCard[];
  eager?: number;
  card?: ThemeCard;
  phoneColumns?: 2 | 3;
}) {
  const style = CARD[card];
  return (
    <ul
      className={cn(
        'grid',
        phoneColumns === 3
          ? 'grid-cols-3 gap-x-2 gap-y-3 sm:grid-cols-4 sm:gap-x-3 md:grid-cols-5'
          : 'grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 md:grid-cols-4 md:gap-x-5',
      )}
    >
      {products.map((product, i) => {
        const urls = product.photo ? imageUrls(product.photo) : null;
        return (
          <li key={product.id}>
            <a href={`/p/${product.id}`} className={cn('group', style.frame)}>
              <div
                className={cn(
                  'relative overflow-hidden bg-(--store-tint)',
                  style.aspect,
                  style.image,
                )}
                style={{ borderRadius: 'var(--store-radius)' }}
              >
                {urls ? (
                  // eslint-disable-next-line @next/next/no-img-element -- pre-sized storage image
                  <img
                    src={urls.md}
                    srcSet={`${urls.sm} 200w, ${urls.md} 600w`}
                    sizes={
                      phoneColumns === 3
                        ? '(min-width: 768px) 20vw, (min-width: 640px) 25vw, 33vw'
                        : '(min-width: 768px) 25vw, (min-width: 640px) 33vw, 50vw'
                    }
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
                  <span className="absolute top-2 left-2 rounded-full bg-(--store-fg)/85 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-(--store-bg) uppercase sm:top-2.5 sm:left-2.5 sm:px-2.5 sm:py-1 sm:text-[11px]">
                    Sold out
                  </span>
                ) : product.fewLeft !== null ? (
                  <span
                    className="absolute top-2 left-2 rounded-full px-2 py-0.5 text-[10px] font-semibold shadow-sm sm:top-2.5 sm:left-2.5 sm:px-2.5 sm:py-1 sm:text-[11px]"
                    style={{
                      backgroundColor: 'var(--store-accent)',
                      color: 'var(--store-on-accent)',
                    }}
                  >
                    Only {product.fewLeft} left
                  </span>
                ) : null}
              </div>
              <div className={style.text}>
                <span className={style.name}>{product.name}</span>
                <span className={style.price}>
                  {product.hasPriceRange ? (
                    <span className="text-[0.85em] font-normal opacity-75">From </span>
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
