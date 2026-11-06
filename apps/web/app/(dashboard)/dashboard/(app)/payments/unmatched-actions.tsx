'use client';

import { formatNaira } from '@fulcra/config';
import { Button, FieldMessage, Input, Label, NativeSelect } from '@fulcra/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { assignPaymentAction, dismissPaymentAction } from './actions';

type Order = { id: string; orderNumber: number; total: number; customerName: string };

/** Assign an unmatched transfer to an unpaid order of the same amount, or mark it not for an order. */
export function UnmatchedActions({
  paymentId,
  amount,
  customerName,
  orders,
}: {
  paymentId: string;
  amount: number;
  customerName: string | null;
  orders: Order[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'assign' | 'dismiss' | null>(null);
  // Orders with exactly this amount, the payer's own orders first.
  const candidates = orders
    .filter((o) => o.total === amount)
    .sort(
      (a, b) => Number(b.customerName === customerName) - Number(a.customerName === customerName),
    );
  const [orderId, setOrderId] = useState(candidates[0]?.id ?? '');
  const [note, setNote] = useState('');

  const run = (action: () => Promise<{ ok: boolean; message?: string }>) =>
    startTransition(async () => {
      setError(null);
      const result = await action();
      if (result.ok) router.refresh();
      else setError(result.message ?? 'Something went wrong.');
    });

  return (
    <div className="flex flex-col gap-2 border-t pt-2">
      {mode === null && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={() => setMode('assign')}>
            Assign to an order
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setMode('dismiss')}>
            Not for an order
          </Button>
        </div>
      )}
      {mode === 'assign' &&
        (candidates.length === 0 ? (
          <FieldMessage>
            No unpaid order is exactly {formatNaira(amount)}. Part payments are not supported yet;
            you can record a new order for this amount, or mark this payment as not for an order.
          </FieldMessage>
        ) : (
          <div className="flex flex-col gap-2">
            <Label htmlFor={`assign-${paymentId}`}>Order</Label>
            <NativeSelect
              id={`assign-${paymentId}`}
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
            >
              {candidates.map((o) => (
                <option key={o.id} value={o.id}>
                  #{o.orderNumber} · {o.customerName || 'No name'} · {formatNaira(o.total)}
                </option>
              ))}
            </NativeSelect>
            <Button
              type="button"
              size="sm"
              loading={pending}
              onClick={() => run(() => assignPaymentAction(paymentId, orderId))}
            >
              Mark this order paid
            </Button>
          </div>
        ))}
      {mode === 'dismiss' && (
        <div className="flex flex-col gap-2">
          <Label htmlFor={`dismiss-${paymentId}`}>What was it for? (optional)</Label>
          <Input
            id={`dismiss-${paymentId}`}
            placeholder="e.g. Refunded, or a gift"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            loading={pending}
            onClick={() => run(() => dismissPaymentAction(paymentId, note))}
          >
            Mark as not for an order
          </Button>
        </div>
      )}
      {mode !== null && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="self-start"
          onClick={() => {
            setMode(null);
            setError(null);
          }}
        >
          Back
        </Button>
      )}
      {error && <FieldMessage error>{error}</FieldMessage>}
    </div>
  );
}
