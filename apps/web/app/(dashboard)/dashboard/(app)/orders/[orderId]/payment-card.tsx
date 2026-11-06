'use client';

import { formatNaira } from '@fulcra/config';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, FieldMessage } from '@fulcra/ui';
import { Check, Copy, ExternalLink, Link2, MessageCircle, Receipt } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createPaymentLinkAction } from '../actions';

type PaymentRow = {
  id: string;
  provider: 'paystack' | 'manual';
  status: 'pending' | 'success' | 'failed' | 'needs_review';
  amount: number;
  method: string | null;
  checkoutUrl: string | null;
  reviewReason: string | null;
  when: string;
};

type Props = {
  orderId: string;
  orderNumber: number;
  total: number;
  isUnpaid: boolean;
  isPaid: boolean;
  canEdit: boolean;
  payoutReady: boolean;
  businessName: string;
  customerName: string;
  customerPhone: string | null;
  receiptLink: string;
  payments: PaymentRow[];
};

const statusTone = {
  pending: 'warning',
  success: 'success',
  failed: 'neutral',
  needs_review: 'danger',
} as const;
const statusLabel = {
  pending: 'Waiting',
  success: 'Received',
  failed: 'Failed',
  needs_review: 'Check this',
} as const;

function waLink(phone: string | null, text: string) {
  const to = phone ? phone.replace(/^\+/, '') : '';
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}

export function PaymentCard(p: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const latestLink =
    p.payments.find((x) => x.provider === 'paystack' && x.status === 'pending' && x.checkoutUrl)
      ?.checkoutUrl ?? null;
  const [link, setLink] = useState<string | null>(latestLink);
  const firstName = p.customerName.split(' ')[0] || 'there';

  const create = () =>
    startTransition(async () => {
      setError(null);
      const result = await createPaymentLinkAction(p.orderId);
      if (result.ok) {
        setLink(result.data.url);
        router.refresh();
      } else setError(result.message);
    });

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  };

  const payMessage = link
    ? `Hello ${firstName}, here is the payment link for your order #${p.orderNumber} from ${p.businessName} (${formatNaira(p.total)}): ${link}`
    : '';
  const receiptMessage = `Hello ${firstName}, thank you for your payment! Here is your receipt for order #${p.orderNumber}: ${p.receiptLink}`;
  const review = p.payments.filter((x) => x.status === 'needs_review');

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Payment</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {review.map((r) => (
          <p
            key={r.id}
            role="alert"
            className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger"
          >
            A payment of {formatNaira(r.amount)} needs your attention: {r.reviewReason}
          </p>
        ))}

        {p.isUnpaid &&
          p.canEdit &&
          (!p.payoutReady ? (
            <p className="text-sm text-muted-foreground">
              To send payment links, first{' '}
              <Link href="/settings/payments" className="text-primary underline">
                add your bank account
              </Link>
              .
            </p>
          ) : link ? (
            <div className="flex flex-col gap-2">
              <p className="rounded bg-muted px-2 py-1 font-mono text-xs break-all">{link}</p>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <a href={waLink(p.customerPhone, payMessage)} target="_blank" rel="noreferrer">
                    <MessageCircle aria-hidden /> Send on WhatsApp
                  </a>
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => copy(link, 'pay')}>
                  {copied === 'pay' ? <Check aria-hidden /> : <Copy aria-hidden />}{' '}
                  {copied === 'pay' ? 'Copied' : 'Copy link'}
                </Button>
              </div>
              <FieldMessage>
                The order is marked paid by itself as soon as Paystack confirms the payment.
              </FieldMessage>
            </div>
          ) : (
            <Button type="button" loading={pending} onClick={create}>
              <Link2 aria-hidden /> Create payment link · {formatNaira(p.total)}
            </Button>
          ))}

        {p.isPaid && (
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm">
              <a href={waLink(p.customerPhone, receiptMessage)} target="_blank" rel="noreferrer">
                <MessageCircle aria-hidden /> Send receipt
              </a>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => copy(p.receiptLink, 'receipt')}
            >
              {copied === 'receipt' ? <Check aria-hidden /> : <Copy aria-hidden />}{' '}
              {copied === 'receipt' ? 'Copied' : 'Copy receipt link'}
            </Button>
            <Button asChild variant="ghost" size="sm">
              <a href={p.receiptLink} target="_blank" rel="noreferrer">
                <Receipt aria-hidden /> View <ExternalLink aria-hidden />
              </a>
            </Button>
          </div>
        )}

        {p.payments.length > 0 && (
          <ul className="flex flex-col divide-y text-sm">
            {p.payments.map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-3 py-2">
                <span>
                  {x.provider === 'paystack' ? 'Paystack' : 'Recorded by you'}
                  {x.method ? ` · ${x.method.replace('_', ' ')}` : ''}
                  <span className="block text-xs text-muted-foreground">{x.when}</span>
                </span>
                <span className="flex items-center gap-2">
                  {formatNaira(x.amount)}
                  <Badge tone={statusTone[x.status]}>{statusLabel[x.status]}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
        {error && <FieldMessage error>{error}</FieldMessage>}
      </CardContent>
    </Card>
  );
}
