import { APP_NAME } from '@fulcra/config';
import { Badge } from '@fulcra/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { requireAdminPage } from '@/lib/admin';

export const metadata: Metadata = {
  title: { absolute: `${APP_NAME} admin` },
  robots: { index: false },
};

/** Fulcra's own staff area (AD1): only for emails in ADMIN_EMAILS; "not found" for everyone else. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const admin = await requireAdminPage();
  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4 md:px-8">
          <Link href="/admin" className="flex items-center gap-2 font-semibold tracking-[-0.01em]">
            <span className="inline-block size-2.5 rounded-full bg-primary" aria-hidden />
            {APP_NAME}
            <Badge tone="info">Admin</Badge>
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <Link href="/admin" className="rounded-full px-3 py-1.5 hover:bg-muted">
              Overview
            </Link>
            <Link href="/admin/sellers" className="rounded-full px-3 py-1.5 hover:bg-muted">
              Sellers
            </Link>
            <Link href="/admin/activity" className="rounded-full px-3 py-1.5 hover:bg-muted">
              Activity
            </Link>
          </nav>
          <span className="ml-auto hidden truncate text-xs text-muted-foreground sm:block">
            {admin.email}
          </span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">{children}</main>
    </div>
  );
}
