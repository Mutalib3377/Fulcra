'use client';

import { Button } from '@fulcra/ui';
import { useState, useTransition } from 'react';
import { goTo } from '@/lib/navigation';
import { acceptInviteAction } from './actions';

export function AcceptInviteButton({ token }: { token: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        fullWidth
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await acceptInviteAction(token);
            if (result.ok) goTo(result.data.redirectTo);
            else setError(result.message);
          })
        }
      >
        Accept and join
      </Button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </>
  );
}
