import { APP_NAME } from '@fulcra/config';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = { title: 'Dashboard', robots: { index: false } };

// Placeholder shell. The mobile-first shell (bottom nav / sidebar) is built in C1.
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-14 max-w-5xl items-center px-4 font-semibold">
          {APP_NAME}
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
