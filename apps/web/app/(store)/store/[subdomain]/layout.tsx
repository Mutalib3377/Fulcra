import { textColourOn } from '@fulcra/core';
import type { Metadata } from 'next';
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

/** Applies the brand kit (colours and font) to every page of the store. */
export default async function StoreLayout({ children, params }: Props) {
  const { subdomain } = await params;
  const store = await loadStore(subdomain);
  if (!store) notFound();
  const { brand } = store;
  const theme = {
    '--store-primary': brand.primaryColour,
    '--store-on-primary': textColourOn(brand.primaryColour),
    '--store-accent': brand.accentColour,
    '--store-on-accent': textColourOn(brand.accentColour),
    fontFamily: brandFontOptions[brand.font].stack,
  } as CSSProperties;
  return (
    <div className="flex min-h-dvh flex-col bg-background" style={theme}>
      {children}
    </div>
  );
}
