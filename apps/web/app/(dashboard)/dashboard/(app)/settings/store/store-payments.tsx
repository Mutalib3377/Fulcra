'use client';

import { FieldMessage, ListGroup, ListRow, Switch } from '@fulcra/ui';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { setStoreCheckoutAction } from './actions';

/** "Let customers pay on my store" (K1). Needs a payout account; owner only. */
export function StorePayments({
  enabled,
  hasPayout,
  canEdit,
}: {
  enabled: boolean;
  hasPayout: boolean;
  canEdit: boolean;
}) {
  const [on, setOn] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const change = (next: boolean) => {
    setOn(next);
    setError(null);
    startTransition(async () => {
      const result = await setStoreCheckoutAction(next);
      if (!result.ok) {
        setOn(!next);
        setError(result.message);
      }
    });
  };
  return (
    <ListGroup
      title="Payments on your store"
      footer={
        hasPayout
          ? on
            ? 'Customers add to cart and pay with Paystack (card, transfer or USSD). The money goes to your bank account. "Order on WhatsApp" stays too.'
            : 'Customers order on WhatsApp only.'
          : undefined
      }
    >
      <ListRow
        title="Let customers pay on my store"
        trailing={
          <Switch
            checked={on && hasPayout}
            onCheckedChange={change}
            disabled={!canEdit || !hasPayout || pending}
            aria-label="Let customers pay on my store"
          />
        }
      />
      {!hasPayout ? (
        <div className="px-4 py-3 text-sm text-muted-foreground">
          First add the bank account where you get paid:{' '}
          <Link href="/settings/payments" className="font-medium text-primary">
            Settings → Get paid
          </Link>
          .
        </div>
      ) : null}
      {error ? (
        <div className="px-4 pb-3">
          <FieldMessage>{error}</FieldMessage>
        </div>
      ) : null}
    </ListGroup>
  );
}
