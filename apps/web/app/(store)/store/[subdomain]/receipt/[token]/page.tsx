import { formatNaira } from '@fulcra/config';
import { getReceipt, paymentMethodLabel } from '@fulcra/core';
import { Button, EmptyState } from '@fulcra/ui';
import { CheckCircle2, Download, Loader2 } from 'lucide-react';
import type { Metadata } from 'next';
import { imageUrls } from '@/lib/images';
import { formatDateTime } from '@/lib/orders';
import { AutoRefresh } from './auto-refresh';

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

  if (!receipt.isPaid) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <AutoRefresh seconds={5} />
        <Loader2
          className="size-8 animate-spin"
          style={{ color: brand.primaryColour }}
          aria-hidden
        />
        <h1 className="text-xl font-bold">Confirming your payment…</h1>
        <p className="text-muted-foreground">
          Order #{order.orderNumber} from {business.name}. This page updates by itself. If you have
          paid, there is nothing else to do.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-8">
      <article className="overflow-hidden rounded-lg border bg-card shadow-xs">
        <header
          className="flex items-center gap-3 px-5 py-4 text-white"
          style={{ backgroundColor: brand.primaryColour }}
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
          <p className="flex items-center gap-2 font-semibold text-success">
            <CheckCircle2 className="size-5" aria-hidden /> Paid {formatNaira(order.amountPaid)}
          </p>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-muted-foreground">Customer</dt>
            <dd className="text-right">{receipt.customerName || '—'}</dd>
            <dt className="text-muted-foreground">Date paid</dt>
            <dd className="text-right">{order.paidAt ? formatDateTime(order.paidAt) : '—'}</dd>
            <dt className="text-muted-foreground">Payment</dt>
            <dd className="text-right">{paymentMethodLabel(order.paymentMethod)}</dd>
          </dl>
          <ul className="flex flex-col divide-y border-y text-sm">
            {receipt.items.map((item, i) => (
              <li key={i} className="flex justify-between gap-3 py-2">
                <span>
                  {item.quantity} × {item.productName}
                  {item.variantLabel ? (
                    <span className="text-muted-foreground"> ({item.variantLabel})</span>
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
            <div className="flex justify-between text-base font-bold">
              <span>Total</span>
              <span>{formatNaira(order.total)}</span>
            </div>
          </div>
        </div>
      </article>
      <div className="mt-4 flex flex-col gap-2">
        <Button asChild variant="outline">
          <a href={`/receipt/${token}/pdf`} download>
            <Download aria-hidden /> Download PDF
          </a>
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Thank you for shopping with {business.name}.
        </p>
      </div>
    </main>
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
