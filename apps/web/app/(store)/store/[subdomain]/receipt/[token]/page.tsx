import { formatNaira } from '@fulcra/config';
import { getReceipt, paymentMethodLabel } from '@fulcra/core';
import { EmptyState } from '@fulcra/ui';
import { CheckCircle2, Download, Loader2 } from 'lucide-react';
import type { Metadata } from 'next';
import { imageUrls } from '@/lib/images';
import { formatDateTime } from '@/lib/orders';
import { AutoRefresh } from '@/components/auto-refresh';

type Props = { params: Promise<{ subdomain: string; token: string }> };

export const metadata: Metadata = { title: 'Receipt', robots: { index: false } };

/** Customer-facing receipt, on the business's own store address. */
export default async function ReceiptPage({ params }: Props) {
  const { subdomain, token } = await params;
  const receipt = await getReceipt(subdomain, token);
  if (!receipt) {
    return (
      <main className="flex flex-1 items-center justify-center px-4">
        <EmptyState title="Receipt not found" description="Check that you opened the full link." />
      </main>
    );
  }
  const { business, brand, order } = receipt;
  const logo = brand.logo ? imageUrls(brand.logo).sm : null;

  if (!receipt.isPaid && order.status === 'cancelled') {
    // A store checkout that wasn't paid in time (or was cancelled by the shop).
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <h1 className="text-2xl font-semibold">This order was cancelled</h1>
        <p className="text-(--store-subtle)">
          Order #{order.orderNumber} from {business.name} was not paid in time, so the items went
          back on sale. If you paid, don&apos;t worry: {business.name} will see your payment and
          contact you.
        </p>
        <a
          href="/"
          className="mt-2 inline-flex min-h-11 items-center rounded-(--store-button-radius) px-5 font-semibold"
          style={{ backgroundColor: 'var(--store-primary)', color: 'var(--store-on-primary)' }}
        >
          Back to the store
        </a>
      </main>
    );
  }

  if (!receipt.isPaid) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <AutoRefresh seconds={5} />
        <Loader2
          className="size-8 animate-spin"
          style={{ color: 'var(--store-primary)' }}
          aria-hidden
        />
        <h1 className="text-2xl font-semibold">Confirming your payment…</h1>
        <p className="text-(--store-subtle)">
          Order #{order.orderNumber} from {business.name}. This page updates by itself. If you have
          paid, there is nothing else to do.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-8">
      <article
        className="overflow-hidden border border-(--store-line) bg-(--store-surface) shadow-sm"
        style={{ borderRadius: 'var(--store-radius)' }}
      >
        <header
          className="flex items-center gap-3 px-5 py-4"
          style={{ backgroundColor: 'var(--store-primary)', color: 'var(--store-on-primary)' }}
        >
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- pre-sized storage image
            <img src={logo} alt="" className="size-10 rounded bg-white object-contain" />
          ) : null}
          <div className="min-w-0">
            <p className="truncate font-semibold">{business.name}</p>
            <p className="text-sm opacity-90">Receipt · Order #{order.orderNumber}</p>
          </div>
        </header>
        <div className="flex flex-col gap-4 p-5">
          <p className="flex items-center gap-2 font-semibold text-(--store-success)">
            <CheckCircle2 className="size-5" aria-hidden /> Paid {formatNaira(order.amountPaid)}
          </p>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-(--store-subtle)">Customer</dt>
            <dd className="text-right">{receipt.customerName || '—'}</dd>
            <dt className="text-(--store-subtle)">Date paid</dt>
            <dd className="text-right">{order.paidAt ? formatDateTime(order.paidAt) : '—'}</dd>
            <dt className="text-(--store-subtle)">Payment</dt>
            <dd className="text-right">{paymentMethodLabel(order.paymentMethod)}</dd>
          </dl>
          <ul className="flex flex-col divide-y divide-(--store-line) border-y border-(--store-line) text-sm">
            {receipt.items.map((item, i) => (
              <li key={i} className="flex justify-between gap-3 py-2">
                <span>
                  {item.quantity} × {item.productName}
                  {item.variantLabel ? (
                    <span className="text-(--store-subtle)"> ({item.variantLabel})</span>
                  ) : null}
                </span>
                <span className="shrink-0">{formatNaira(item.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-1 text-sm">
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
            <div className="flex justify-between text-base font-semibold">
              <span>Total</span>
              <span>{formatNaira(order.total)}</span>
            </div>
          </div>
        </div>
      </article>
      <div className="mt-4 flex flex-col gap-2">
        <a
          href={`/receipt/${token}/pdf`}
          download
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-(--store-button-radius) bg-(--store-surface) px-5 font-medium ring-1 ring-(--store-line-strong) hover:bg-(--store-tint)"
        >
          <Download className="size-4" aria-hidden /> Download PDF
        </a>
        <p className="text-center text-xs text-(--store-subtle)">
          Thank you for shopping with {business.name}.
        </p>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-(--store-subtle)">{label}</span>
      <span>{value}</span>
    </div>
  );
}
