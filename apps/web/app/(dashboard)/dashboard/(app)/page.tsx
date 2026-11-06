import {
  countOrdersByStatus,
  countPaymentsNeedingAttention,
  listEvents,
  listLowStock,
  variantLabel,
} from '@fulcra/core';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
} from '@fulcra/ui';
import { ExternalLink, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDashboardContext } from '@/lib/auth';
import { describeEvent, timeAgo } from '@/lib/orders';
import { storeHost, storeUrl } from '@/lib/urls';

export const metadata: Metadata = { title: 'Home' };

export default async function DashboardHome() {
  const { actor, membership } = await getDashboardContext();
  const isEditor = membership.role !== 'rider';
  const [counts, events, lowStock, attention] = await Promise.all([
    countOrdersByStatus(actor),
    listEvents(actor, { limit: 15 }),
    listLowStock(actor),
    isEditor ? countPaymentsNeedingAttention(actor) : Promise.resolve({ unmatched: 0, review: 0 }),
  ]);
  const now = new Date();
  const tiles = [
    { label: 'New', count: counts.new, href: '/orders?status=new' },
    {
      label: 'Awaiting payment',
      count: counts.awaiting_payment,
      href: '/orders?status=awaiting_payment',
    },
    { label: 'Paid, to send', count: counts.paid, href: '/orders?status=paid' },
    { label: 'Dispatched', count: counts.dispatched, href: '/orders?status=dispatched' },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Welcome</h1>
          <p className="text-muted-foreground">Here is how {membership.businessName} is doing.</p>
        </div>
        {membership.role !== 'rider' && (
          <Button asChild className="shrink-0">
            <Link href="/orders/new">
              <Plus aria-hidden /> Order
            </Link>
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href}>
            <Card className="p-3 transition-colors hover:bg-muted/50">
              <p className="text-2xl font-bold">{t.count}</p>
              <p className="text-sm text-muted-foreground">{t.label}</p>
            </Card>
          </Link>
        ))}
      </div>

      {attention.unmatched + attention.review > 0 && (
        <Link
          href={attention.unmatched ? '/payments?show=unmatched' : '/payments?show=review'}
          className="rounded-md border border-warning bg-warning-soft px-3 py-2 text-sm text-warning"
        >
          {[
            attention.unmatched
              ? `${attention.unmatched} transfer${attention.unmatched === 1 ? '' : 's'} to match`
              : '',
            attention.review
              ? `${attention.review} payment${attention.review === 1 ? '' : 's'} to check`
              : '',
          ]
            .filter(Boolean)
            .join(' · ')}{' '}
          →
        </Link>
      )}

      {lowStock.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Running low</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm">
              {lowStock.slice(0, 5).map((item) => (
                <li key={item.variantId} className="flex items-center justify-between gap-3">
                  <Link
                    href={`/catalog/${item.productId}`}
                    className="min-w-0 truncate text-primary"
                  >
                    {item.productName}
                    {item.isDefault ? '' : ` – ${variantLabel(item)}`}
                  </Link>
                  <Badge tone={item.stock === 0 ? 'danger' : 'warning'}>
                    {item.stock === 0 ? 'Sold out' : `${item.stock} left`}
                  </Badge>
                </li>
              ))}
            </ul>
            {lowStock.length > 5 && (
              <Link
                href="/catalog?show=low_stock"
                className="mt-2 inline-block text-sm text-primary"
              >
                See all {lowStock.length}
              </Link>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Recent activity</CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <EmptyState
              title="Nothing yet"
              description="New orders, payments and low stock will show here."
              className="py-6"
            />
          ) : (
            <ol className="flex flex-col gap-3 text-sm">
              {events.map((e) => {
                const { text, href } = describeEvent(e);
                return (
                  <li key={e.id} className="flex justify-between gap-3">
                    {href ? (
                      <Link href={href} className="min-w-0 text-primary">
                        {text}
                      </Link>
                    ) : (
                      <span>{text}</span>
                    )}
                    <span className="shrink-0 text-muted-foreground">
                      {timeAgo(e.createdAt, now)}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your store link</CardTitle>
          <CardDescription>Share this with customers once your store is ready.</CardDescription>
        </CardHeader>
        <CardContent>
          <a
            href={storeUrl(membership.subdomain)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 font-medium break-all text-primary underline-offset-4 hover:underline"
          >
            {storeHost(membership.subdomain)}
            <ExternalLink className="size-4 shrink-0" aria-hidden />
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
