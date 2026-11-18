import {
  countOrdersByStatus,
  countPaymentsNeedingAttention,
  getHomeSummary,
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
import { formatNaira } from '@fulcra/config';
import { ExternalLink, MessageCircle, Plus, Sparkles } from 'lucide-react';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { getDashboardContext } from '@/lib/auth';
import { describeEvent, timeAgo } from '@/lib/orders';
import { setupHiddenCookie } from '@/lib/setup';
import { storeHost, storeUrl } from '@/lib/urls';
import { CopyStoreLink } from './copy-store-link';
import { showSetupAction } from './home-actions';
import { SetupChecklist } from './setup-checklist';

export const metadata: Metadata = { title: 'Home' };

export default async function DashboardHome() {
  const { actor, membership } = await getDashboardContext();
  const isEditor = membership.role !== 'rider';
  const [summary, counts, events, lowStock, attention, cookieStore] = await Promise.all([
    getHomeSummary(actor),
    countOrdersByStatus(actor),
    listEvents(actor, { limit: 15 }),
    listLowStock(actor),
    isEditor ? countPaymentsNeedingAttention(actor) : Promise.resolve({ unmatched: 0, review: 0 }),
    cookies(),
  ]);
  const setup = summary.setup;
  const setupHidden = cookieStore.get(setupHiddenCookie(actor.businessId))?.value === '1';
  const setupUnfinished = setup !== null && setup.done < setup.total;
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
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">Welcome</h1>
          <p className="text-muted-foreground">Here is how {membership.businessName} is doing.</p>
        </div>
        <div className="flex shrink-0 gap-2">
          {membership.role === 'owner' && (
            <Button asChild variant="tinted" size="icon" aria-label="Ask Fulcra">
              <Link href="/ask">
                <Sparkles aria-hidden />
              </Link>
            </Button>
          )}
          {membership.role !== 'rider' && (
            <Button asChild className="shrink-0">
              <Link href="/orders/new">
                <Plus aria-hidden /> Order
              </Link>
            </Button>
          )}
        </div>
      </div>

      {setupUnfinished && !setupHidden && (
        <SetupChecklist setup={setup} hasExternalWebsite={summary.hasExternalWebsite} />
      )}

      <div className="grid grid-cols-2 gap-2">
        <Card className="p-3">
          <p className="text-sm text-muted-foreground">Today&apos;s sales</p>
          <p className="text-2xl font-semibold">{formatNaira(summary.today.amount)}</p>
          <p className="text-sm text-muted-foreground">
            {summary.today.orders} paid order{summary.today.orders === 1 ? '' : 's'}
          </p>
        </Card>
        {summary.chatsWaiting !== null ? (
          <Link href="/inbox">
            <Card
              className={
                summary.chatsWaiting > 0
                  ? 'h-full border-warning bg-warning-soft p-3 transition-colors'
                  : 'h-full p-3 transition-colors hover:bg-muted/50'
              }
            >
              <p className="flex items-center gap-1 text-sm text-muted-foreground">
                <MessageCircle className="size-4" aria-hidden /> Chats waiting
              </p>
              <p className="text-2xl font-semibold">{summary.chatsWaiting}</p>
              <p className="text-sm text-muted-foreground">
                {summary.chatsWaiting > 0 ? 'Customers need you' : 'All answered'}
              </p>
            </Card>
          </Link>
        ) : (
          <Link href="/orders?status=paid">
            <Card className="h-full p-3 transition-colors hover:bg-muted/50">
              <p className="text-sm text-muted-foreground">To deliver</p>
              <p className="text-2xl font-semibold">{counts.paid + counts.dispatched}</p>
            </Card>
          </Link>
        )}
      </div>

      {setupUnfinished && setupHidden && (
        <form action={showSetupAction} className="-mt-2">
          <button type="submit" className="text-sm text-primary underline-offset-4 hover:underline">
            Show setup guide ({setup.done} of {setup.total} done)
          </button>
        </form>
      )}

      <p className="-mb-2 text-sm font-medium text-muted-foreground">Orders</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href}>
            <Card className="p-3 transition-colors hover:bg-muted/50">
              <p className="text-2xl font-semibold">{t.count}</p>
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
          <CardDescription>
            Customers can see your products here and order on WhatsApp. Share it in your status, bio
            and chats.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <a
            href={storeUrl(membership.subdomain)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 font-medium break-all text-primary underline-offset-4 hover:underline"
          >
            {storeHost(membership.subdomain)}
            <ExternalLink className="size-4 shrink-0" aria-hidden />
          </a>
          <CopyStoreLink
            url={storeUrl(membership.subdomain)}
            businessName={membership.businessName}
          />
        </CardContent>
      </Card>
    </div>
  );
}
