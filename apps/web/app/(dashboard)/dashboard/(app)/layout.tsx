import { APP_NAME } from '@fulcra/config';
import { Badge } from '@fulcra/ui';
import { LogOut } from 'lucide-react';
import type { ReactNode } from 'react';
import { ActionButton } from '@/components/action-button';
import { QueryProvider } from '@/components/query-provider';
import { getDashboardContext } from '@/lib/auth';
import { signOut } from '../(auth)/sign-in/actions';
import { BottomNav, SideNav } from './nav-links';

const roleLabels = { owner: 'Owner', staff: 'Staff', rider: 'Rider' } as const;

/** Mobile-first dashboard shell: bottom nav on phones, sidebar on desktop. */
export default async function AppShellLayout({ children }: { children: ReactNode }) {
  const { membership } = await getDashboardContext();

  return (
    <QueryProvider>
      <div className="min-h-dvh md:flex">
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r bg-card md:flex">
          <div className="flex h-14 items-center border-b px-6 font-bold text-primary">
            {APP_NAME}
          </div>
          <SideNav />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-3 border-b bg-card px-4">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-semibold">{membership.businessName}</span>
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
          <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-24 md:pb-10">
            {children}
          </main>
        </div>

        <BottomNav />
      </div>
    </QueryProvider>
  );
}
