import { formatNaira } from '@fulcra/config';
import { listCustomers } from '@fulcra/core';
import { Badge, Button, Card, EmptyState, Input } from '@fulcra/ui';
import { Search, Users } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDashboardContext } from '@/lib/auth';
import { OrdersCustomersTabs } from '../orders/tabs';

export const metadata: Metadata = { title: 'Customers' };

type Props = { searchParams: Promise<{ q?: string }> };

export default async function CustomersPage({ searchParams }: Props) {
  const { actor } = await getDashboardContext();
  const { q } = await searchParams;
  const search = q?.trim().slice(0, 100) || undefined;
  const customers = await listCustomers(actor, search ? { search } : {});

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Customers</h1>
      <OrdersCustomersTabs active="customers" />
      <form action="/customers" method="get" className="flex gap-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute top-3.5 left-3 size-4 text-muted-foreground"
            aria-hidden
          />
          <Input
            name="q"
            defaultValue={search ?? ''}
            placeholder="Name or phone"
            className="pl-9"
            aria-label="Search customers"
          />
        </div>
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      {customers.length === 0 ? (
        <EmptyState
          icon={<Users aria-hidden />}
          title={search ? 'No customers match' : 'No customers yet'}
          description={
            search
              ? 'Try another name or phone number.'
              : 'Customers are added when you record their first order.'
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {customers.map((c) => (
            <li key={c.id}>
              <Link href={`/customers/${c.id}`} className="block">
                <Card className="flex items-center justify-between gap-3 p-3 transition-colors hover:bg-muted/50">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{c.name || 'No name'}</p>
                    <p className="text-sm text-muted-foreground">{c.phone ?? 'No phone'}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge tone={c.kind === 'repeat' ? 'success' : 'info'}>
                        {c.kind === 'repeat' ? 'Repeat' : 'New'}
                      </Badge>
                      {c.tags.map((t) => (
                        <Badge key={t} tone="neutral">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-sm">
                    <p className="font-semibold">{formatNaira(c.totalSpent)}</p>
                    <p className="text-muted-foreground">
                      {c.orderCount} {c.orderCount === 1 ? 'order' : 'orders'}
                    </p>
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
