import { textColourOn } from '@fulcra/core';
import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import type { CSSProperties, ReactNode } from 'react';
import { storeThemeFor } from '@/lib/store-theme-server';
import { themeTypography } from '@/lib/store-themes';
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
  if (!store) return { themeColor: '#ffffff' };
  const { theme } = await storeThemeFor(store);
  return { themeColor: theme === 'bold' ? '#0b0b0f' : store.brand.primaryColour };
}

/** Applies the brand kit (colours, heading style and corners) to every page of the store. */
export default async function StoreLayout({ children, params }: Props) {
  const { subdomain } = await params;
  const store = await loadStore(subdomain);
  if (!store) notFound();
  const { brand } = store;
  const { theme: themeKey, option } = await storeThemeFor(store);
  const font = themeTypography(themeKey, brand.font);
  const theme = {
    '--store-primary': brand.primaryColour,
    '--store-on-primary': textColourOn(brand.primaryColour),
    '--store-accent': brand.accentColour,
    '--store-on-accent': textColourOn(brand.accentColour),
    '--store-display': font.stack,
    '--store-display-weight': font.weight,
    '--store-tracking': font.tracking,
    // Themes with their own corner style set it in CSS; Classic follows the font.
    ...(option.radius === null ? { '--store-radius': font.radius } : {}),
  } as CSSProperties;
  return (
    <div
      className="store flex min-h-dvh flex-col bg-(--store-bg) text-(--store-fg)"
      data-store-theme={themeKey}
      style={theme}
    >
      {children}
    </div>
  );
}
