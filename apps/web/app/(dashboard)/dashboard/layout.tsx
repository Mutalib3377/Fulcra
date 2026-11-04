import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { QueryProvider } from './query-provider';

export const metadata: Metadata = { title: 'Dashboard', robots: { index: false } };

export default function DashboardRootLayout({ children }: { children: ReactNode }) {
  return <QueryProvider>{children}</QueryProvider>;
}
