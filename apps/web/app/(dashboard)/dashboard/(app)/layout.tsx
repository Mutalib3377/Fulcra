import { APP_NAME } from '@fulcra/config';
import { Badge } from '@fulcra/ui';
import { LogOut } from 'lucide-react';
import type { ReactNode } from 'react';
import { ActionButton } from '@/components/action-button';
import { Monitoring } from '@/components/monitoring';
import { QueryProvider } from '@/components/query-provider';
import { getDashboardContext } from '@/lib/auth';
import { signOut } from '../(auth)/sign-in/actions';
import { BillingBanner } from './billing-banner';
import { BottomNav, SideNav } from './nav-links';

const roleLabels = { owner: 'Owner', staff: 'Staff', rider: 'Rider' } as const;

/** Mobile-first dashboard shell: bottom nav on phones, sidebar on desktop. */
export default async function AppShellLayout({ children }: { children: ReactNode }) {
  const { membership, actor } = await getDashboardContext();

  return (
    <QueryProvider>
      <Monitoring area="dashboard" userId={actor.userId} businessId={actor.businessId} />
      <div className="min-h-dvh md:flex">
        <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r bg-card/60 md:flex">
          <div className="flex h-16 items-center px-6 text-lg font-semibold tracking-[-0.02em]">
            <span className="mr-2 inline-block size-2.5 rounded-full bg-primary" aria-hidden />
            {APP_NAME}
          </div>
          <SideNav />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-3 border-b border-border/60 bg-background/80 px-4 backdrop-blur-xl backdrop-saturate-150 md:h-16 md:px-8">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-semibold tracking-[-0.01em]">
                {membership.businessName}
              </span>
              <Badge tone="neutral">{roleLabels[membership.role]}</Badge>
            </div>
            <ActionButton
              action={signOut}
              redirectTo="/sign-in"
              variant="ghost"
              size="sm"
              aria-label="Sign out"
            >
              <LogOut aria-hidden />
              <span className="hidden sm:inline">Sign out</span>
            </ActionButton>
          </header>
          <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-28 sm:px-6 md:px-8 md:pt-8 md:pb-12">
            {membership.role !== 'rider' && <BillingBanner actor={actor} />}
            {children}
          </main>
        </div>

        <BottomNav />
      </div>
    </QueryProvider>
  );
}
