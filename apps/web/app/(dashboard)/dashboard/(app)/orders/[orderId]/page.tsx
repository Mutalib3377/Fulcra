import { formatNaira } from '@fulcra/config';
import {
  getBusiness,
  getOrder,
  getPayoutSettings,
  isCoreError,
  listEvents,
  listOrderPayments,
  PAYMENT_METHOD_LABELS,
  receiptUrl,
  type ManualPaymentMethod,
} from '@fulcra/core';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState } from '@fulcra/ui';
import { MessageCircle, Phone } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { getDashboardContext } from '@/lib/auth';
import {
  describeEvent,
  formatDateTime,
  ORDER_STATUS_TONES,
  orderStatusLabel,
  timeAgo,
} from '@/lib/orders';
import { OrderActions } from './order-actions';
import { PaymentCard } from './payment-card';

export const metadata: Metadata = { title: 'Order' };

type Props = { params: Promise<{ orderId: string }> };

export default async function OrderPage({ params }: Props) {
  const { orderId } = await params;
  const { actor, membership } = await getDashboardContext();

  const notFound = (
    <EmptyState
      title="Order not found"
      description="Check the link, or find it in your orders."
      action={
        <Button asChild variant="outline">
          <Link href="/orders">Back to orders</Link>
        </Button>
      }
    />
  );
  if (!z.uuid().safeParse(orderId).success) return notFound;
  let detail;
  try {
    detail = await getOrder(actor, orderId);
  } catch (error) {
    if (isCoreError(error) && error.code === 'not_found') return notFound;
    throw error;
  }
  const { order, items, customer } = detail;
  const [events, payments, payout, business] = await Promise.all([
    listEvents(actor, { orderId, limit: 50 }),
    listOrderPayments(actor, orderId),
    getPayoutSettings(actor),
    getBusiness(actor),
  ]);
  const now = new Date();
  const waNumber = customer.phone?.replace(/^\+/, '');

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div>
        <Link href="/orders" className="text-sm text-primary">
          ← Orders
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">Order #{order.orderNumber}</h1>
          <Badge tone={ORDER_STATUS_TONES[order.status]}>{orderStatusLabel(order.status)}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{formatDateTime(order.createdAt)}</p>
      </div>

      <OrderActions
        orderId={order.id}
        status={order.status}
        fulfilment={order.fulfilment}
        total={order.total}
        role={membership.role}
      />

      {order.status !== 'cancelled' && (
        <PaymentCard
          orderId={order.id}
          orderNumber={order.orderNumber}
          total={order.total}
          isUnpaid={order.status === 'new' || order.status === 'awaiting_payment'}
          isPaid={order.amountPaid > 0}
          canEdit={membership.role !== 'rider'}
          payoutReady={payout.configured}
          businessName={business.name}
          customerName={customer.name}
          customerPhone={customer.phone}
          receiptLink={receiptUrl(business.subdomain, order.receiptToken)}
          payments={payments.map((x) => ({
            id: x.id,
            provider: x.provider,
            status: x.status,
            amount: x.amount,
            method: x.method,
            checkoutUrl: x.checkoutUrl,
            reviewReason: x.reviewReason,
            when: formatDateTime(x.paidAt ?? x.createdAt),
          }))}
        />
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Customer</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Link href={`/customers/${customer.id}`} className="font-medium text-primary">
            {customer.name || 'No name'}
          </Link>
          {customer.phone && (
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <a href={`tel:${customer.phone}`}>
                  <Phone aria-hidden /> {customer.phone}
                </a>
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href={`https://wa.me/${waNumber}`} target="_blank" rel="noreferrer">
                  <MessageCircle aria-hidden /> WhatsApp
                </a>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Items</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <ul className="flex flex-col divide-y">
            {items.map((item) => (
              <li key={item.id} className="flex justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="font-medium">
                    {item.quantity} × {item.productName}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {item.variantLabel ? `${item.variantLabel} · ` : ''}
                    {formatNaira(item.unitPrice)} each{item.isWholesale ? ' (wholesale)' : ''}
                  </p>
                </div>
                <span className="shrink-0">{formatNaira(item.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-1 border-t pt-2 text-sm">
            <Row label="Items" value={formatNaira(order.subtotal)} />
            {order.fulfilment === 'delivery' && (
              <Row
                label={`Delivery (${order.deliveryZoneName})`}
                value={formatNaira(order.deliveryFee)}
              />
            )}
            {order.discount > 0 && (
              <Row label="Discount" value={`−${formatNaira(order.discount)}`} />
            )}
            <div className="flex justify-between text-base font-bold">
              <span>Total</span>
              <span>{formatNaira(order.total)}</span>
            </div>
            {order.amountPaid > 0 && (
              <Row
                label={
                  order.paymentMethod === 'paystack'
                    ? 'Paid online'
                    : `Paid${order.paymentMethod ? ` (${PAYMENT_METHOD_LABELS[order.paymentMethod as ManualPaymentMethod] ?? order.paymentMethod})` : ''}`
                }
                value={formatNaira(order.amountPaid)}
              />
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {order.fulfilment === 'pickup' ? 'Pickup' : 'Delivery'}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm">
          {order.fulfilment === 'pickup' ? (
            <p>The customer collects this order.</p>
          ) : (
            <>
              <p className="font-medium">{order.deliveryZoneName}</p>
              <p className="whitespace-pre-line">{order.deliveryAddress}</p>
            </>
          )}
          {order.notes && <p className="mt-2 rounded-md bg-muted px-3 py-2">Note: {order.notes}</p>}
          {order.status === 'cancelled' && order.cancelReason && (
            <p className="mt-2 text-danger">Cancelled: {order.cancelReason}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="flex flex-col gap-3">
            {events.map((e) => (
              <li key={e.id} className="flex justify-between gap-3 text-sm">
                <span>{describeEvent(e).text}</span>
                <span className="shrink-0 text-muted-foreground">{timeAgo(e.createdAt, now)}</span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
