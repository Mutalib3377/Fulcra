import { formatNaira } from '@fulcra/config';
import { countOrdersByStatus, listOrders, orderListFilter } from '@fulcra/core';
import { Badge, Button, Card, EmptyState, Input, cn } from '@fulcra/ui';
import { Plus, Search, ShoppingBag } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDashboardContext } from '@/lib/auth';
import { ORDER_STATUS_TONES, orderStatusLabel, timeAgo } from '@/lib/orders';
import { OrdersCustomersTabs } from './tabs';

export const metadata: Metadata = { title: 'Orders' };

type Props = { searchParams: Promise<{ status?: string; q?: string }> };

const tabs = [
  { status: 'open', label: 'Open' },
  { status: 'new', label: 'New' },
  { status: 'awaiting_payment', label: 'Awaiting payment' },
  { status: 'paid', label: 'Paid' },
  { status: 'dispatched', label: 'Dispatched' },
  { status: 'delivered', label: 'Delivered' },
  { status: 'cancelled', label: 'Cancelled' },
  { status: 'all', label: 'All' },
] as const;

export default async function OrdersPage({ searchParams }: Props) {
  const { actor, membership } = await getDashboardContext();
  const params = await searchParams;
  const parsed = orderListFilter.safeParse({
    status: params.status || 'open',
    search: params.q || undefined,
  });
  const f = parsed.success ? parsed.data : orderListFilter.parse({ status: 'open' });
  const [orders, counts] = await Promise.all([listOrders(actor, f), countOrdersByStatus(actor)]);
  const openCount = counts.new + counts.awaiting_payment + counts.paid + counts.dispatched;
  const countFor = (status: string) =>
    status === 'open' ? openCount : status === 'all' ? null : counts[status as keyof typeof counts];
  const canCreate = membership.role !== 'rider';
  const now = new Date();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Orders</h1>
        {canCreate && (
          <Button asChild>
            <Link href="/orders/new">
              <Plus aria-hidden /> New order
            </Link>
          </Button>
        )}
      </div>
      <OrdersCustomersTabs active="orders" />

      <form action="/orders" method="get" className="flex gap-2">
        <input type="hidden" name="status" value={f.status} />
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute top-3.5 left-3 size-4 text-muted-foreground"
            aria-hidden
          />
          <Input
            name="q"
            defaultValue={f.search ?? ''}
            placeholder="Order number, name or phone"
            className="pl-9"
            aria-label="Search orders"
          />
        </div>
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      <nav aria-label="Order status" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {tabs.map((tab) => {
          const count = countFor(tab.status);
          const active = f.status === tab.status;
          return (
            <Link
              key={tab.status}
              href={tab.status === 'open' ? '/orders' : `/orders?status=${tab.status}`}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'rounded-full border px-4 py-1.5 text-sm whitespace-nowrap',
                active ? 'border-primary bg-primary text-primary-foreground' : 'bg-card',
              )}
            >
              {tab.label}
              {count ? ` (${count})` : ''}
            </Link>
          );
        })}
      </nav>

      {orders.length === 0 ? (
        <EmptyState
          icon={<ShoppingBag aria-hidden />}
          title={f.search ? 'No orders match' : 'No orders here'}
          description={
            f.search
              ? 'Try another order number, name or phone.'
              : 'Orders you record, and orders the assistant takes later, appear here.'
          }
          action={
            canCreate && !f.search ? (
              <Button asChild>
                <Link href="/orders/new">
                  <Plus aria-hidden /> Record an order
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {orders.map((o) => (
            <li key={o.id}>
              <Link href={`/orders/${o.id}`} className="block">
                <Card className="flex items-center justify-between gap-3 p-3 transition-colors hover:bg-muted/50">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      #{o.orderNumber}{' '}
                      <span className="font-normal text-muted-foreground">
                        · {o.customerName || o.customerPhone || 'No name'}
                      </span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {o.itemCount} {o.itemCount === 1 ? 'item' : 'items'} ·{' '}
                      {o.fulfilment === 'pickup' ? 'Pickup' : 'Delivery'} ·{' '}
                      {timeAgo(o.createdAt, now)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="font-semibold">{formatNaira(o.total)}</span>
                    <Badge tone={ORDER_STATUS_TONES[o.status]}>{orderStatusLabel(o.status)}</Badge>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
