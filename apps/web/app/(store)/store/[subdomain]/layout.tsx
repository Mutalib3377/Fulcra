import { textColourOn } from '@fulcra/core';
import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import type { CSSProperties, ReactNode } from 'react';
import { brandFontOptions } from '@/lib/brand-fonts';
import { loadStore } from '@/lib/store';

type Props = { children: ReactNode; params: Promise<{ subdomain: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { subdomain } = await params;
  const store = await loadStore(subdomain);
  if (!store) return { title: { absolute: 'Store not found' }, robots: { index: false } };
  // `absolute` keeps the app name out of store titles; pages fill the template.
  return { title: { absolute: store.name, template: `%s · ${store.name}` } };
}

/** The phone's browser bar takes the store's colour. */
export async function generateViewport({ params }: Props): Promise<Viewport> {
  const { subdomain } = await params;
  const store = await loadStore(subdomain);
  return { themeColor: store?.brand.primaryColour ?? '#ffffff' };
}

/** Applies the brand kit (colours, heading style and corners) to every page of the store. */
export default async function StoreLayout({ children, params }: Props) {
  const { subdomain } = await params;
  const store = await loadStore(subdomain);
  if (!store) notFound();
  const { brand } = store;
  const font = brandFontOptions[brand.font];
  const theme = {
    '--store-primary': brand.primaryColour,
    '--store-on-primary': textColourOn(brand.primaryColour),
    '--store-accent': brand.accentColour,
    '--store-on-accent': textColourOn(brand.accentColour),
    '--store-display': font.stack,
    '--store-display-weight': font.weight,
    '--store-tracking': font.tracking,
    '--store-radius': font.radius,
  } as CSSProperties;
  return (
    <div className="store flex min-h-dvh flex-col bg-white text-[#111827]" style={theme}>
      {children}
    </div>
  );
}
