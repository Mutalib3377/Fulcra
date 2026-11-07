import { formatNaira } from '@fulcra/config';
import {
  getCustomer,
  getCustomerDedicatedAccount,
  isCoreError,
  listDeliveryZones,
  listEvents,
} from '@fulcra/core';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState } from '@fulcra/ui';
import { MessageCircle, Phone, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { getDashboardContext } from '@/lib/auth';
import { describeEvent, ORDER_STATUS_TONES, orderStatusLabel, timeAgo } from '@/lib/orders';
import { CustomerForm } from './customer-form';

export const metadata: Metadata = { title: 'Customer' };

type Props = { params: Promise<{ customerId: string }> };

const channelLabels = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  web: 'Website chat',
} as const;

export default async function CustomerPage({ params }: Props) {
  const { customerId } = await params;
  const { actor, membership } = await getDashboardContext();
  const notFound = (
    <EmptyState
      title="Customer not found"
      action={
        <Button asChild variant="outline">
          <Link href="/customers">Back to customers</Link>
        </Button>
      }
    />
  );
  if (!z.uuid().safeParse(customerId).success) return notFound;
  let detail;
  try {
    detail = await getCustomer(actor, customerId);
  } catch (error) {
    if (isCoreError(error) && error.code === 'not_found') return notFound;
    throw error;
  }
  const [zones, events, dedicated] = await Promise.all([
    listDeliveryZones(actor),
    listEvents(actor, { customerId, limit: 20 }),
    getCustomerDedicatedAccount(actor, customerId),
  ]);
  const { customer, orders, identities } = detail;
  const canEdit = membership.role !== 'rider';
  const now = new Date();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div>
        <Link href="/customers" className="text-sm text-primary">
          ← Customers
        </Link>
        <h1 className="truncate text-2xl font-bold">{customer.name || 'No name'}</h1>
        <div className="mt-1 flex flex-wrap gap-1">
          <Badge tone={detail.kind === 'repeat' ? 'success' : 'info'}>
            {detail.kind === 'repeat' ? 'Repeat customer' : 'New customer'}
          </Badge>
          {customer.tags.map((t) => (
            <Badge key={t} tone="neutral">
              {t}
            </Badge>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {canEdit && (
          <Button asChild>
            <Link href={`/orders/new?customer=${customer.id}`}>
              <Plus aria-hidden /> New order
            </Link>
          </Button>
        )}
        {customer.phone && (
          <>
            <Button asChild variant="outline">
              <a href={`tel:${customer.phone}`}>
                <Phone aria-hidden /> Call
              </a>
            </Button>
            <Button asChild variant="outline">
              <a
                href={`https://wa.me/${customer.phone.replace(/^\+/, '')}`}
                target="_blank"
                rel="noreferrer"
              >
                <MessageCircle aria-hidden /> WhatsApp
              </a>
            </Button>
          </>
        )}
      </div>

      <Card>
        <CardContent className="grid grid-cols-2 gap-3 pt-4 sm:pt-6">
          <div>
            <p className="text-sm text-muted-foreground">Orders</p>
            <p className="text-xl font-bold">
              {orders.filter((o) => o.status !== 'cancelled').length}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Total spent</p>
            <p className="text-xl font-bold">{formatNaira(detail.totalSpent)}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Orders</CardTitle>
        </CardHeader>
        <CardContent>
          {orders.length === 0 ? (
            <p className="text-sm text-muted-foreground">No orders yet.</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {orders.map((o) => (
                <li key={o.id}>
                  <Link
                    href={`/orders/${o.id}`}
                    className="flex items-center justify-between gap-3 py-2"
                  >
                    <span>
                      #{o.orderNumber}{' '}
                      <span className="text-sm text-muted-foreground">
                        · {timeAgo(o.createdAt, now)}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-sm">{formatNaira(o.total)}</span>
                      <Badge tone={ORDER_STATUS_TONES[o.status]}>
                        {orderStatusLabel(o.status)}
                      </Badge>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <CustomerForm
        customerId={customer.id}
        canEdit={canEdit}
        zones={zones.map((z) => ({ id: z.id, name: z.name }))}
        initial={{
          name: customer.name,
          phone: customer.phone ?? '',
          email: customer.email ?? '',
          address: customer.address,
          deliveryZoneId: customer.deliveryZoneId ?? '',
          tags: customer.tags.join(', '),
          notes: customer.notes,
          marketingOptIn: customer.marketingOptIn,
        }}
      />

      {dedicated && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Their account for paying you</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p>
              {dedicated.bankName} ·{' '}
              <span className="font-mono font-semibold">{dedicated.accountNumber}</span>
            </p>
            <p className="text-muted-foreground">{dedicated.accountName}</p>
            <p className="mt-2 text-muted-foreground">
              Transfers into this account are matched to this customer’s orders automatically.
            </p>
          </CardContent>
        </Card>
      )}

      {identities.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Chats with this customer</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            {identities.map((i) => (
              <p key={i.id}>
                {channelLabels[i.channel]}
                {i.displayName ? `: ${i.displayName}` : ''}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {events.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-2 text-sm">
              {events.map((e) => (
                <li key={e.id} className="flex justify-between gap-3">
                  <span>{describeEvent(e).text}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {timeAgo(e.createdAt, now)}
                  </span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
