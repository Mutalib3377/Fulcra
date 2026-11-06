import { cn } from '@fulcra/ui';
import Link from 'next/link';

/** Orders and Customers share one bottom-nav slot on phones. */
export function OrdersCustomersTabs({ active }: { active: 'orders' | 'customers' }) {
  const item = (key: 'orders' | 'customers', label: string, href: string) => (
    <Link
      href={href}
      aria-current={active === key ? 'page' : undefined}
      className={cn(
        'flex-1 rounded-md py-2 text-center text-sm font-medium',
        active === key ? 'bg-card shadow-xs' : 'text-muted-foreground',
      )}
    >
      {label}
    </Link>
  );
  return (
    <div className="flex gap-1 rounded-lg bg-muted p-1">
      {item('orders', 'Orders', '/orders')}
      {item('customers', 'Customers', '/customers')}
    </div>
  );
}
