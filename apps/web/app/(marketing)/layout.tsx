import { APP_NAME } from '@fulcra/config';
import type { Viewport } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Monitoring } from '@/components/monitoring';
import { dashboardUrl } from '@/lib/urls';

export const viewport: Viewport = { themeColor: '#050f0c' };

/** Marketing site shell: page content, then a quiet footer. */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  const year = new Date().getFullYear();
  return (
    <>
      <Monitoring area="marketing" />
      {children}
      <footer className="border-t bg-background">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 font-medium text-foreground">
            <span className="inline-block size-2.5 rounded-full bg-primary" aria-hidden />
            {APP_NAME}
            <span className="font-normal text-muted-foreground">· Made for sellers in Nigeria</span>
          </p>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
            <Link href="/#pricing" className="hover:text-foreground">
              Pricing
            </Link>
            <Link href="/privacy" className="hover:text-foreground">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-foreground">
              Terms
            </Link>
            <a href={dashboardUrl('/sign-in')} className="hover:text-foreground">
              Sign in
            </a>
          </nav>
          <p>
            © {year} {APP_NAME}
          </p>
        </div>
      </footer>
    </>
  );
}
