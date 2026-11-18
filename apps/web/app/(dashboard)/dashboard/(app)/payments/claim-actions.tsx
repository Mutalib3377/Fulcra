'use client';

import { Button, FieldMessage } from '@fulcra/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { dismissPaymentClaimAction } from './actions';

/** Close a payment check the owner has looked into (asks once before closing). */
export function ClaimActions({ claimId }: { claimId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () =>
    startTransition(async () => {
      setError(null);
      const result = await dismissPaymentClaimAction(claimId);
      if (result.ok) router.refresh();
      else setError(result.message ?? 'Something went wrong.');
    });

  return (
    <div className="flex flex-col gap-2 border-t pt-2">
      {confirming ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            Fulcra will stop checking this payment. If the money reached you another way, mark the
            order paid so stock and receipts stay right.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={close} disabled={pending}>
              {pending ? 'Closing…' : 'Yes, close it'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Keep checking
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(true)}>
            I&apos;ve looked into it, close this
          </Button>
        </div>
      )}
      {error && <FieldMessage>{error}</FieldMessage>}
    </div>
  );
}
