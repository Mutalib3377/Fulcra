import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { colorSchemeFor, parseTheme, THEME_COLOURS, THEME_COOKIE } from '@/lib/theme';
import { QueryProvider } from './query-provider';

export const metadata: Metadata = { title: 'Dashboard', robots: { index: false } };

export async function generateViewport(): Promise<Viewport> {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  if (theme !== 'system') return { themeColor: THEME_COLOURS[theme] };
  return {
    themeColor: [
      { media: '(prefers-color-scheme: light)', color: THEME_COLOURS.light },
      { media: '(prefers-color-scheme: dark)', color: THEME_COLOURS.dark },
    ],
  };
}

/**
 * The dashboard's look: the owner's choice from Settings → Appearance (a cookie, read here so
 * the first paint is right), or the phone's light or dark setting by default
 * (data-color-scheme, see the UI tokens).
 */
export default async function DashboardRootLayout({ children }: { children: ReactNode }) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <div data-color-scheme={colorSchemeFor(theme)} className="contents">
      <QueryProvider>{children}</QueryProvider>
    </div>
  );
}
