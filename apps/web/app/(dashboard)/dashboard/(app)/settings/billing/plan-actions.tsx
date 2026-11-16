'use client';

import { Button } from '@fulcra/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { cancelPlanAction, choosePlanAction } from './actions';

type Mode = 'choose' | 'upgrade' | 'downgrade' | 'current';

/** The buttons under one plan: choose (monthly / yearly), upgrade, or switch at renewal. */
export function PlanButtons({
  plan,
  mode,
  planName,
}: {
  plan: 'starter' | 'growth' | 'pro';
  mode: Mode;
  planName: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  if (mode === 'current') return null;

  const go = (interval: 'monthly' | 'annual') =>
    start(async () => {
      setMessage(null);
      const result = await choosePlanAction(plan, interval);
      if (!result.ok) return setMessage({ ok: false, text: result.message });
      if (result.data.kind === 'checkout') {
        window.location.assign(result.data.url); // Paystack's secure payment page
        return;
      }
      setMessage({
        ok: true,
        text: `Done. ${planName} starts on ${new Date(result.data.startsAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'long' })}, when your current plan ends.`,
      });
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-2">
      {mode === 'downgrade' ? (
        <Button variant="outline" loading={pending} onClick={() => go('monthly')}>
          Switch to {planName} at renewal
        </Button>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            loading={pending}
            onClick={() => go('monthly')}
            aria-label={`${mode === 'upgrade' ? 'Upgrade to' : 'Choose'} ${planName} monthly`}
          >
            {mode === 'upgrade' ? 'Upgrade' : 'Choose'} monthly
          </Button>
          <Button
            variant="outline"
            loading={pending}
            onClick={() => go('annual')}
            aria-label={`${mode === 'upgrade' ? 'Upgrade to' : 'Choose'} ${planName} yearly`}
          >
            Yearly
          </Button>
        </div>
      )}
      {message && (
        <p
          role={message.ok ? 'status' : 'alert'}
          className={`text-xs ${message.ok ? 'text-success' : 'text-danger'}`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}

/** "Cancel plan" with a confirmation. */
export function CancelPlanButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="ghost"
        className="self-start"
        loading={pending}
        onClick={() => {
          if (
            !window.confirm(
              'Cancel your plan? It keeps working until the end of the period you paid for.',
            )
          )
            return;
          start(async () => {
            const result = await cancelPlanAction();
            if (!result.ok) return setError(result.message);
            router.refresh();
          });
        }}
      >
        Cancel plan
      </Button>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
