import { ArrowRight, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ThemeHero } from '@/lib/store-themes';
import { StoreLogo } from './store-logo';
import { WhatsAppButton } from './whatsapp-button';

export type HeroPhoto = { id: string; name: string; src: string };

export type StoreHeroProps = {
  variant: ThemeHero;
  name: string;
  description: string;
  logo: string | null;
  productCount: number;
  deliveryAvailable: boolean;
  /** The website chat is on ("Chat to buy" opens it; without JavaScript it is WhatsApp). */
  webChat: boolean;
  hello: string;
  /** Featured photos, in stock, best first. */
  photos: HeroPhoto[];
};

/**
 * The top of the store home, one layout per theme (T1). Every layout has the store's name,
 * what it sells, "Order on WhatsApp" and a way into the products; only the look differs.
 */
export function StoreHero(props: StoreHeroProps) {
  switch (props.variant) {
    case 'minimal':
      return <MinimalHero {...props} />;
    case 'split':
      return <SplitHero {...props} />;
    case 'dark':
      return <DarkHero {...props} />;
    case 'banner':
      return <BannerHero {...props} />;
    case 'playful':
      return <PlayfulHero {...props} />;
    default:
      return <CollageHero {...props} />;
  }
}

function countLine({ productCount, deliveryAvailable }: StoreHeroProps) {
  if (productCount === 0) return null;
  return `${productCount} ${productCount === 1 ? 'product' : 'products'}${deliveryAvailable ? ' · Delivery available' : ''}`;
}

/** The second button: open the chat, or jump to the products. */
function SecondButton({ props, className }: { props: StoreHeroProps; className: string }) {
  if (props.webChat) {
    return (
      <a href={props.hello} data-fulcra-open className={className}>
        Chat to buy
      </a>
    );
  }
  if (props.productCount === 0) return null;
  return (
    <a href="#shop" className={className}>
      Browse products <ArrowRight className="size-4" aria-hidden />
    </a>
  );
}

function Img({
  photo,
  eager,
  className,
  style,
}: {
  photo: HeroPhoto;
  eager?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- pre-sized storage image
    <img
      src={photo.src}
      alt=""
      loading={eager ? 'eager' : 'lazy'}
      fetchPriority={eager ? 'high' : undefined}
      decoding="async"
      className={className}
      style={style}
    />
  );
}

const onPrimaryGhost =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-(--store-button-radius) bg-white/15 px-6 font-semibold ring-1 ring-white/30 backdrop-blur-sm hover:bg-white/25';
const pageGhost =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-(--store-button-radius) px-6 font-semibold ring-1 ring-(--store-line-strong) hover:bg-(--store-tint)';
const brandSolid =
  'inline-flex min-h-12 items-center justify-center gap-2 px-7 font-semibold shadow-sm transition-transform active:scale-[0.98]';

// ─── Classic: brand colours, fanned photo collage ────────────────────────────

function CollageHero(props: StoreHeroProps) {
  const line = countLine(props);
  return (
    <section className="store-hero relative isolate overflow-hidden text-[var(--store-on-primary)]">
      <div className="store-dots pointer-events-none absolute inset-0 -z-10" aria-hidden />
      <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 pt-10 pb-12 md:grid-cols-[1.1fr_1fr] md:pt-16 md:pb-20">
        <div className="flex flex-col items-start gap-5">
          {props.logo ? (
            <StoreLogo name={props.name} src={props.logo} size={64} className="shadow-lg" />
          ) : null}
          {line ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium ring-1 ring-white/20 backdrop-blur-sm">
              <Sparkles className="size-3.5" aria-hidden />
              {line}
            </span>
          ) : null}
          <h1 className="store-display text-[2.6rem] leading-[1.04] text-balance sm:text-5xl md:text-6xl">
            {props.name}
          </h1>
          {props.description ? (
            <p className="max-w-lg text-[1.0625rem] leading-relaxed whitespace-pre-line opacity-90">
              {props.description}
            </p>
          ) : null}
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <WhatsAppButton href={props.hello} className="w-full sm:w-auto">
              Order on WhatsApp
            </WhatsAppButton>
            <SecondButton props={props} className={onPrimaryGhost} />
          </div>
        </div>
        {props.photos.length > 0 ? <Collage photos={props.photos.slice(0, 3)} /> : null}
      </div>
    </section>
  );
}

function Collage({ photos }: { photos: HeroPhoto[] }) {
  const placements = [
    'left-1/2 top-2 z-20 w-[52%] -translate-x-1/2 rotate-[-2deg]',
    'left-0 top-10 z-10 w-[44%] rotate-[-9deg]',
    'right-0 top-12 z-10 w-[44%] rotate-[8deg]',
  ];
  return (
    <div className="relative mx-auto -mb-4 h-[16.5rem] w-full max-w-md sm:h-[23rem]" aria-hidden>
      {photos.map((p, i) => (
        <a
          key={p.id}
          href={`/p/${p.id}`}
          tabIndex={-1}
          className={`absolute aspect-[4/5] overflow-hidden bg-(--store-surface) p-1.5 shadow-[0_20px_40px_-12px_rgb(0_0_0/0.45)] transition-transform duration-500 hover:rotate-0 ${photos.length === 1 ? 'top-2 left-1/2 z-20 w-[62%] -translate-x-1/2 rotate-[-3deg]' : placements[i]}`}
          style={{ borderRadius: 'calc(var(--store-radius) + 0.25rem)' }}
        >
          <Img
            photo={p}
            eager={i === 0}
            className="size-full object-cover"
            style={{ borderRadius: 'var(--store-radius)' }}
          />
        </a>
      ))}
    </div>
  );
}

// ─── Minimal: white, centred, big type, a clean row of photos ────────────────

function MinimalHero(props: StoreHeroProps) {
  const line = countLine(props);
  return (
    <section className="border-b border-(--store-line)">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-6 px-4 pt-14 pb-10 text-center md:pt-24 md:pb-16">
        {props.logo ? <StoreLogo name={props.name} src={props.logo} size={52} /> : null}
        {line ? (
          <span className="text-xs font-medium tracking-[0.18em] text-(--store-subtle) uppercase">
            {line}
          </span>
        ) : null}
        <h1 className="store-display max-w-3xl text-[2.9rem] leading-[1.02] text-balance md:text-7xl">
          {props.name}
        </h1>
        {props.description ? (
          <p className="max-w-xl text-lg leading-relaxed whitespace-pre-line text-(--store-muted)">
            {props.description}
          </p>
        ) : null}
        <div className="flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row">
          <WhatsAppButton href={props.hello} className="w-full sm:w-auto">
            Order on WhatsApp
          </WhatsAppButton>
          <SecondButton props={props} className={pageGhost} />
        </div>
        {props.photos.length > 0 ? (
          <div
            className={`mt-6 grid w-full gap-2 md:gap-4 ${props.photos.length >= 3 ? 'grid-cols-3' : 'grid-cols-2'}`}
          >
            {props.photos.slice(0, 3).map((p, i) => (
              <a
                key={p.id}
                href={`/p/${p.id}`}
                tabIndex={-1}
                aria-hidden
                className="block overflow-hidden"
                style={{ borderRadius: 'var(--store-radius)' }}
              >
                <Img
                  photo={p}
                  eager={i === 0}
                  className="aspect-square w-full bg-(--store-tint) object-cover"
                />
              </a>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

// ─── Boutique: one big photo beside the name, magazine style ─────────────────

function SplitHero(props: StoreHeroProps) {
  const photo = props.photos[0];
  return (
    <section className="border-b border-(--store-line)">
      <div className="mx-auto grid w-full max-w-6xl md:grid-cols-2 md:items-center md:gap-14 md:px-4 md:py-14">
        {photo ? (
          <a href={`/p/${photo.id}`} tabIndex={-1} aria-hidden className="block md:order-2">
            <Img
              photo={photo}
              eager
              className="aspect-[4/5] w-full bg-(--store-tint) object-cover md:max-h-[38rem]"
            />
          </a>
        ) : null}
        <div className="flex flex-col items-start gap-5 px-4 py-10 md:order-1 md:px-0">
          {props.logo ? <StoreLogo name={props.name} src={props.logo} size={48} /> : null}
          <span className="text-[11px] font-medium tracking-[0.28em] text-(--store-subtle) uppercase">
            {props.deliveryAvailable ? 'Shop online · Delivered to you' : 'Shop online'}
          </span>
          <h1 className="store-display text-[2.75rem] leading-[1.05] text-balance md:text-6xl">
            {props.name}
          </h1>
          <span className="h-px w-16 bg-(--store-fg)" aria-hidden />
          {props.description ? (
            <p className="max-w-md text-lg leading-relaxed whitespace-pre-line text-(--store-muted)">
              {props.description}
            </p>
          ) : null}
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
            {props.productCount > 0 ? (
              <a
                href="#shop"
                className={`${brandSolid} min-h-12 tracking-wide`}
                style={{
                  backgroundColor: 'var(--store-fg)',
                  color: 'var(--store-bg)',
                  borderRadius: 'var(--store-radius)',
                }}
              >
                Shop the collection <ArrowRight className="size-4" aria-hidden />
              </a>
            ) : null}
            <a
              href={props.hello}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-12 items-center justify-center px-2 font-medium underline decoration-(--store-line-strong) underline-offset-[6px] hover:decoration-current"
            >
              Order on WhatsApp
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Bold: dark page, huge type, bright brand buttons ────────────────────────

function DarkHero(props: StoreHeroProps) {
  const line = countLine(props);
  return (
    <section className="relative isolate overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        aria-hidden
        style={{
          background:
            'radial-gradient(80% 60% at 85% 10%, color-mix(in srgb, var(--store-primary) 45%, transparent), transparent 70%)',
        }}
      />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-7 px-4 pt-12 pb-10 md:pt-20">
        {line ? (
          <span className="text-xs font-semibold tracking-[0.2em] text-(--store-ink) uppercase">
            {line}
          </span>
        ) : null}
        <h1 className="store-display text-[3.4rem] leading-[0.92] break-words uppercase md:text-[7rem]">
          {props.name}
        </h1>
        <span
          className="h-2 w-24 rounded-full"
          style={{ backgroundColor: 'var(--store-primary)' }}
          aria-hidden
        />
        {props.description ? (
          <p className="max-w-xl text-lg leading-relaxed whitespace-pre-line text-(--store-muted)">
            {props.description}
          </p>
        ) : null}
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          {props.productCount > 0 ? (
            <a
              href="#shop"
              className={`${brandSolid} rounded-full text-base uppercase`}
              style={{ backgroundColor: 'var(--store-primary)', color: 'var(--store-on-primary)' }}
            >
              Shop now <ArrowRight className="size-4" aria-hidden />
            </a>
          ) : null}
          <WhatsAppButton href={props.hello} className="w-full sm:w-auto">
            Order on WhatsApp
          </WhatsAppButton>
        </div>
        {props.photos.length > 0 ? (
          <ul className="store-scroll -mx-4 mt-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-2">
            {props.photos.slice(0, 4).map((p, i) => (
              <li key={p.id} className="w-[62%] shrink-0 snap-start sm:w-[30%]">
                <a
                  href={`/p/${p.id}`}
                  tabIndex={-1}
                  aria-hidden
                  className="block overflow-hidden ring-1 ring-(--store-line)"
                  style={{ borderRadius: 'var(--store-radius)' }}
                >
                  <Img photo={p} eager={i === 0} className="aspect-[4/5] w-full object-cover" />
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

// ─── Market: a compact banner, then straight to the products ────────────────

function BannerHero(props: StoreHeroProps) {
  return (
    <section className="store-hero text-[var(--store-on-primary)]">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          {props.logo ? (
            <StoreLogo name={props.name} src={props.logo} size={48} className="shadow" />
          ) : null}
          <div className="min-w-0">
            <h1 className="store-display truncate text-2xl leading-tight md:text-3xl">
              {props.name}
            </h1>
            {props.description ? (
              <p className="line-clamp-2 text-sm opacity-90">{props.description}</p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <WhatsAppButton href={props.hello} className="min-h-11 flex-1 px-5 text-sm sm:flex-none">
            Order on WhatsApp
          </WhatsAppButton>
          {props.webChat ? (
            <a
              href={props.hello}
              data-fulcra-open
              className={`${onPrimaryGhost} min-h-11 px-5 text-sm`}
            >
              Chat to buy
            </a>
          ) : null}
        </div>
      </div>
    </section>
  );
}

// ─── Playful: soft colours, round shapes, photos in circles ──────────────────

function PlayfulHero(props: StoreHeroProps) {
  const line = countLine(props);
  const blob = (color: string, className: string): ReactNode => (
    <span
      aria-hidden
      className={`pointer-events-none absolute -z-10 rounded-full ${className}`}
      style={{ backgroundColor: color }}
    />
  );
  return (
    <section className="relative isolate overflow-hidden">
      {blob(
        'color-mix(in srgb, var(--store-primary) 22%, transparent)',
        '-top-16 -left-20 size-64',
      )}
      {blob('color-mix(in srgb, var(--store-accent) 30%, transparent)', 'top-24 -right-24 size-72')}
      {blob(
        'color-mix(in srgb, var(--store-primary) 14%, transparent)',
        'bottom-0 left-1/3 size-40',
      )}
      <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 pt-12 pb-12 md:grid-cols-2 md:pt-20">
        <div className="flex flex-col items-center gap-5 text-center md:items-start md:text-left">
          {props.logo ? (
            <StoreLogo name={props.name} src={props.logo} size={64} className="shadow-md" />
          ) : null}
          {line ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-(--store-surface) px-3.5 py-1.5 text-xs font-semibold shadow-sm">
              <Sparkles className="size-3.5 text-(--store-ink)" aria-hidden />
              {line}
            </span>
          ) : null}
          <h1 className="store-display text-[2.7rem] leading-[1.05] text-balance md:text-6xl">
            {props.name}
          </h1>
          {props.description ? (
            <p className="max-w-md text-lg leading-relaxed whitespace-pre-line text-(--store-muted)">
              {props.description}
            </p>
          ) : null}
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <WhatsAppButton href={props.hello} className="w-full sm:w-auto">
              Order on WhatsApp
            </WhatsAppButton>
            <SecondButton props={props} className={`${pageGhost} bg-(--store-surface) shadow-sm`} />
          </div>
        </div>
        {props.photos.length > 0 ? (
          <div className="relative mx-auto h-64 w-full max-w-sm sm:h-80" aria-hidden>
            {props.photos.slice(0, 3).map((p, i) => (
              <a
                key={p.id}
                href={`/p/${p.id}`}
                tabIndex={-1}
                className={`absolute block overflow-hidden rounded-full border-[6px] border-(--store-surface) shadow-lg ${
                  i === 0
                    ? 'top-0 left-1/2 z-20 size-44 -translate-x-1/2 sm:size-56'
                    : i === 1
                      ? 'bottom-0 left-0 z-10 size-32 sm:size-40'
                      : 'right-0 bottom-4 z-10 size-28 sm:size-36'
                }`}
              >
                <Img photo={p} eager={i === 0} className="size-full object-cover" />
              </a>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
