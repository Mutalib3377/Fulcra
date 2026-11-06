'use client';

import { cn } from '@fulcra/ui';
import { House, MessageCircle, Package, Settings, ShoppingBag, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const items = [
  { href: '/', label: 'Home', icon: House },
  { href: '/inbox', label: 'Inbox', icon: MessageCircle },
  { href: '/orders', label: 'Orders', icon: ShoppingBag },
  { href: '/catalog', label: 'Catalog', icon: Package },
  { href: '/settings', label: 'Settings', icon: Settings },
] as const;

/** The desktop sidebar also lists Customers (on phones it is a tab inside Orders). */
const sideItems = [
  ...items.slice(0, 3),
  { href: '/customers', label: 'Customers', icon: Users },
  ...items.slice(3),
] as const;

function useActive() {
  // The browser shows /orders while the app renders /dashboard/orders; accept both.
  const pathname = usePathname().replace(/^\/dashboard(?=\/|$)/, '') || '/';
  return (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

/** Bottom navigation on phones. */
export function BottomNav() {
  const isActive = useActive();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="grid grid-cols-5">
        {items.map(({ href, label, icon: Icon }) => {
          const active = isActive(href) || (href === '/orders' && isActive('/customers'));
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-16 flex-col items-center justify-center gap-1 text-xs',
                  active ? 'font-semibold text-primary' : 'text-muted-foreground',
                )}
              >
                <Icon className="size-5" aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Sidebar navigation on larger screens. */
export function SideNav() {
  const isActive = useActive();
  return (
    <nav aria-label="Main" className="flex flex-col gap-1 p-3">
      {sideItems.map(({ href, label, icon: Icon }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex h-10 items-center gap-3 rounded-md px-3 text-sm',
              active ? 'bg-secondary font-semibold text-primary' : 'text-foreground hover:bg-muted',
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
