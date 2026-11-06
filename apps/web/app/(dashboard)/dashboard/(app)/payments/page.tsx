import { formatNaira } from '@fulcra/config';
import {
  countPaymentsNeedingAttention,
  listOrders,
  listPayments,
  paymentListFilter,
  paymentMethodLabel,
} from '@fulcra/core';
import { Badge, Card, EmptyState, cn } from '@fulcra/ui';
import { Wallet } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getDashboardContext } from '@/lib/auth';
import { formatDateTime } from '@/lib/orders';
import { OrdersCustomersTabs } from '../orders/tabs';
import { UnmatchedActions } from './unmatched-actions';

export const metadata: Metadata = { title: 'Payments' };

type Props = { searchParams: Promise<{ show?: string }> };

const statusTone = {
  success: 'success',
  unmatched: 'warning',
  needs_review: 'danger',
  dismissed: 'neutral',
  pending: 'neutral',
  failed: 'neutral',
} as const;
const statusLabel = {
  success: 'Received',
  unmatched: 'To match',
  needs_review: 'Check this',
  dismissed: 'Not for an order',
  pending: 'Waiting',
  failed: 'Failed',
} as const;

export default async function PaymentsPage({ searchParams }: Props) {
  const { actor, membership } = await getDashboardContext();
  if (membership.role === 'rider') redirect('/orders');
  const params = await searchParams;
  const parsed = paymentListFilter.safeParse({ show: params.show || undefined });
  const f = parsed.success ? parsed.data : paymentListFilter.parse({});
  const [payments, counts, openOrders] = await Promise.all([
    listPayments(actor, f),
    countPaymentsNeedingAttention(actor),
    listOrders(actor, { status: 'open' }),
  ]);
  const unpaid = openOrders
    .filter((o) => o.status === 'new' || o.status === 'awaiting_payment')
    .map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      total: o.total,
      customerName: o.customerName,
    }));

  const tabs = [
    { show: 'all', label: 'All', count: 0 },
    { show: 'unmatched', label: 'To match', count: counts.unmatched },
    { show: 'review', label: 'Needs checking', count: counts.review },
  ] as const;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Payments</h1>
      <OrdersCustomersTabs active="payments" />
      <nav aria-label="Filter payments" className="flex gap-2 overflow-x-auto">
        {tabs.map((t) => (
          <Link
            key={t.show}
            href={t.show === 'all' ? '/payments' : `/payments?show=${t.show}`}
            aria-current={f.show === t.show ? 'page' : undefined}
            className={cn(
              'rounded-full border px-4 py-1.5 text-sm whitespace-nowrap',
              f.show === t.show ? 'border-primary bg-primary text-primary-foreground' : 'bg-card',
            )}
          >
            {t.label}
            {t.count ? ` (${t.count})` : ''}
          </Link>
        ))}
      </nav>

      {payments.length === 0 ? (
        <EmptyState
          icon={<Wallet aria-hidden />}
          title={
            f.show === 'unmatched'
              ? 'Nothing to match'
              : f.show === 'review'
                ? 'Nothing to check'
                : 'No payments yet'
          }
          description={
            f.show === 'all'
              ? 'Payments by link, bank transfer and the ones you record will appear here.'
              : 'All payments are taken care of.'
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {payments.map((p) => (
            <li key={p.id}>
              <Card className="flex flex-col gap-2 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{formatNaira(p.amount)}</p>
                    <p className="text-sm text-muted-foreground">
                      {p.customerName ?? 'Unknown payer'} ·{' '}
                      {p.provider === 'manual'
                        ? 'Recorded by you'
                        : paymentMethodLabel(p.method) || 'Paystack'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(p.paidAt ?? p.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge tone={statusTone[p.status]}>{statusLabel[p.status]}</Badge>
                    {p.orderId && p.orderNumber && (
                      <Link href={`/orders/${p.orderId}`} className="text-sm text-primary">
                        #{p.orderNumber}
                      </Link>
                    )}
                  </div>
                </div>
                {p.reviewReason && p.status !== 'success' && (
                  <p className="text-sm text-muted-foreground">{p.reviewReason}</p>
                )}
                {p.status === 'unmatched' && (
                  <UnmatchedActions
                    paymentId={p.id}
                    amount={p.amount}
                    customerName={p.customerName}
                    orders={unpaid}
                  />
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
