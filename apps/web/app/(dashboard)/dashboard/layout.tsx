import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { QueryProvider } from './query-provider';

export const metadata: Metadata = { title: 'Dashboard', robots: { index: false } };

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f6f8' },
    { media: '(prefers-color-scheme: dark)', color: '#0e0e10' },
  ],
};

/** The dashboard follows the phone's light or dark setting (data-color-scheme, see the UI tokens). */
export default function DashboardRootLayout({ children }: { children: ReactNode }) {
  return (
    <div data-color-scheme="auto" className="contents">
      <QueryProvider>{children}</QueryProvider>
    </div>
  );
}
