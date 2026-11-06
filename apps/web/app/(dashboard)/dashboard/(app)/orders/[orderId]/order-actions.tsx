'use client';

import { formatNaira } from '@fulcra/config';
import {
  canCancelOrder,
  ORDER_TRANSITIONS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  type FulfilmentMethod,
  type ManualPaymentMethod,
  type OrderStatus,
} from '@fulcra/core/rules';
import { Button, Card, CardContent, FieldMessage, Input, Label, NativeSelect } from '@fulcra/ui';
import { Ban, CheckCircle2, Clock, PackageCheck, Truck, Wallet } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { cancelOrderAction, markPaidAction, moveOrderAction } from '../actions';

type Props = {
  orderId: string;
  status: OrderStatus;
  fulfilment: FulfilmentMethod;
  total: number;
  role: 'owner' | 'staff' | 'rider';
};

/** The next steps for an order, as big buttons. */
export function OrderActions({ orderId, status, fulfilment, total, role }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<'pay' | 'cancel' | null>(null);
  const [method, setMethod] = useState<ManualPaymentMethod>('transfer');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');

  const run = (action: () => Promise<{ ok: boolean; message?: string }>) =>
    startTransition(async () => {
      setError(null);
      const result = await action();
      if (result.ok) {
        setPanel(null);
        router.refresh();
      } else setError(result.message ?? 'Something went wrong.');
    });

  const next = ORDER_TRANSITIONS[status];
  const isEditor = role !== 'rider';
  const canPay = isEditor && next.includes('paid');
  const canAwait = isEditor && next.includes('awaiting_payment');
  const canDispatch = next.includes('dispatched') && fulfilment === 'delivery';
  const canDeliver =
    next.includes('delivered') && (status === 'dispatched' || fulfilment === 'pickup');
  const canCancel = isEditor && canCancelOrder(status);

  if (!canPay && !canAwait && !canDispatch && !canDeliver && !canCancel) {
    return status === 'delivered' ? (
      <p className="flex items-center gap-2 rounded-md bg-success-soft px-3 py-2 text-sm text-success">
        <CheckCircle2 className="size-4" aria-hidden /> This order is complete.
      </p>
    ) : null;
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-4 sm:pt-6">
        <div className="grid gap-2 sm:grid-cols-2">
          {canPay && (
            <Button
              type="button"
              size="lg"
              onClick={() => setPanel(panel === 'pay' ? null : 'pay')}
            >
              <Wallet aria-hidden /> Mark as paid
            </Button>
          )}
          {canDispatch && (
            <Button
              type="button"
              size="lg"
              loading={pending}
              onClick={() => run(() => moveOrderAction(orderId, 'dispatched'))}
            >
              <Truck aria-hidden /> Mark as dispatched
            </Button>
          )}
          {canDeliver && (
            <Button
              type="button"
              size="lg"
              loading={pending}
              onClick={() => run(() => moveOrderAction(orderId, 'delivered'))}
            >
              <PackageCheck aria-hidden />{' '}
              {fulfilment === 'pickup' ? 'Mark as collected' : 'Mark as delivered'}
            </Button>
          )}
          {canAwait && (
            <Button
              type="button"
              size="lg"
              variant="outline"
              loading={pending}
              onClick={() => run(() => moveOrderAction(orderId, 'awaiting_payment'))}
            >
              <Clock aria-hidden /> Waiting for payment
            </Button>
          )}
          {canCancel && (
            <Button
              type="button"
              size="lg"
              variant="ghost"
              className="text-danger"
              onClick={() => setPanel(panel === 'cancel' ? null : 'cancel')}
            >
              <Ban aria-hidden /> Cancel order
            </Button>
          )}
        </div>

        {panel === 'pay' && (
          <div className="flex flex-col gap-3 rounded-md border p-3">
            <p className="text-sm">
              Record that you received <strong>{formatNaira(total)}</strong>.
            </p>
            <div className="flex flex-col gap-2">
              <Label htmlFor="pay-method">How did they pay?</Label>
              <NativeSelect
                id="pay-method"
                value={method}
                onChange={(e) => setMethod(e.target.value as ManualPaymentMethod)}
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABELS[m]}
                  </option>
                ))}
              </NativeSelect>
              {method === 'transfer' && (
                <FieldMessage>
                  Only confirm after you see the money in your bank app, not just a screenshot.
                </FieldMessage>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="pay-note">Note (optional)</Label>
              <Input
                id="pay-note"
                placeholder="e.g. GTBank, 2:15pm"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <Button
              type="button"
              loading={pending}
              onClick={() => run(() => markPaidAction(orderId, method, note))}
            >
              Confirm payment
            </Button>
          </div>
        )}

        {panel === 'cancel' && (
          <div className="flex flex-col gap-3 rounded-md border border-danger p-3">
            <p className="text-sm">
              The items go back into stock.
              {status === 'paid' ? ' If the customer paid, refund them yourself.' : ''}
            </p>
            <div className="flex flex-col gap-2">
              <Label htmlFor="cancel-reason">Reason (optional)</Label>
              <Input
                id="cancel-reason"
                placeholder="e.g. Customer changed their mind"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="danger"
              loading={pending}
              onClick={() => run(() => cancelOrderAction(orderId, reason))}
            >
              Cancel this order
            </Button>
          </div>
        )}

        {error && <FieldMessage error>{error}</FieldMessage>}
      </CardContent>
    </Card>
  );
}
